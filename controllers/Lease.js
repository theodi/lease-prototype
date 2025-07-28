import Lease from '../models/Lease.js';
import User from '../models/User.js';
import LeaseViewStat from '../models/LeaseViewStat.js';
import LeaseTracker from '../models/LeaseTracker.js';
import LeaseTermCache from '../models/LeaseTermCache.js';
import SearchAnalytics from '../models/SearchAnalytics.js';
import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';

import config from '../config/index.js';
const openai = new OpenAI({ apiKey: config.openai.apiKey });

const LeaseTermSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// ─────────────────────────────────────────────
// 🔍 Lease Search
// ─────────────────────────────────────────────
export async function lookup(req, res) {
  try {
    const { query } = req.query;
    // Input validation: enforce max length and allowed characters
    if (!query || query.length < 3) {
      return res.json([]); // Minimum 3 characters required
    }
    if (query.length > 100) {
      return res.status(400).json({ error: 'Query too long' });
    }
    // Allow only letters, numbers, space, comma, period, hyphen, apostrophe, and forward slash
    const allowedPattern = /^[A-Za-z0-9 ,.'\/-]*$/;
    if (!allowedPattern.test(query)) {
      return res.status(400).json({ error: 'Query contains invalid characters.' });
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const hasCredit = await user.hasCredit(true);
    if (!hasCredit) {
      return res.status(403).json({ error: 'You have reached your daily search limit.' });
    }

    const postcodeRegex = /\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})?\b/i;
    const match = query.match(postcodeRegex);
    let results = [];

    if (match) {
      const outward = match[1].toUpperCase();
      const inward = match[2] ? match[2].toUpperCase() : null;

      if (inward) {
        // ✅ Full postcode match — return all results with this postcode
        SearchAnalytics.incrementSearchType('full_postcode');
        const fullPostcode = `${outward} ${inward}`;
        results = await Lease.aggregate([
          { $match: { pc: fullPostcode } },
          {
            $group: {
              _id: '$uid',
              lease: { $first: '$$ROOT' }
            }
          },
          { $replaceRoot: { newRoot: '$lease' } },
          {
            $project: {
              _id: 0,
              uid: 1,
              rpd: 1,
              apd: 1,
              pc: 1
            }
          }
        ]);
      } else {
        // 🟡 Outer postcode only — limit results to 5
        SearchAnalytics.incrementSearchType('outer_postcode');
        results = await Lease.aggregate([
          { $match: { pc: { $regex: `^${outward}`, $options: 'i' } } },
          { $limit: 20 },
          {
            $project: {
              _id: 0,
              uid: 1,
              rpd: 1,
              apd: 1,
              pc: 1
            }
          }
        ]);
      }
    } else {
      SearchAnalytics.incrementSearchType('autocomplete');
      // 🔍 Autocomplete search — check results before falling back
      const autoResults = await Lease.aggregate([
        {
          $search: {
            index: 'addr_autocomplete',
            text: {
              query,
              path: { wildcard: '*' }
            }
          }
        },
        { $limit: 20 },
        {
          $project: {
            _id: 0,
            uid: 1,
            rpd: 1,
            apd: 1,
            pc: 1
          }
        }
      ]);

      const containsQuery = autoResults.some(r =>
        (r.rpd || '').toLowerCase().includes(query.toLowerCase()) ||
        (r.apd || '').toLowerCase().includes(query.toLowerCase())
      );

      if (autoResults.length > 0 && containsQuery) {
        results = autoResults.slice(0, 5); // limit to 5 manually
      } else {
        // 🔁 Fallback to default index search
        SearchAnalytics.incrementSearchType('fallback');
        results = await Lease.aggregate([
          {
            $search: {
              index: 'default',
              text: {
                query,
                path: ['rpd', 'apd' ]
              }
            }
          },
          { $limit: 20 },
          {
            $project: {
              _id: 0,
              uid: 1,
              rpd: 1,
              apd: 1,
              pc: 1
            }
          }
        ]);
      }
    }

    res.json(results.map(mapLeaseToVirtual));
  } catch (error) {
    console.error('Lease lookup error:', error);
    res.status(500).json({ error: 'Failed to lookup lease' });
  }
}

function mapLeaseToVirtual(lease) {
  return {
    'Unique Identifier': lease.uid,
    'Register Property Description': lease.rpd,
    'Associated Property Description': lease.apd,
    'Postcode': lease.pc,
    ...lease // optionally include other fields
  };
}


// ─────────────────────────────────────────────
// 🧠 Lease Term Parser
// ─────────────────────────────────────────────
export async function parseLeaseTerm(termStr) {
  const cached = await LeaseTermCache.findOne({ term: termStr });
  if (cached?.startDate && cached?.expiryDate) {
    return {
      startDate: new Date(cached.startDate),
      expiryDate: new Date(cached.expiryDate),
      source: 'ai'
    };
  }

  let match = termStr.match(/^[\s\u00A0]*(\d{1,4})[ \u00A0]*years?(?:[ \u00A0]+from[ \u00A0]+(\d{1,2})[ \u00A0]+([A-Za-z]+)[ \u00A0]+(\d{4}))/i);
  if (match) {
    const years = parseInt(match[1], 10);
    const startDate = new Date(`${match[2]} ${match[3]} ${match[4]}`);
    if (!isNaN(startDate)) {
      const expiryDate = new Date(startDate);
      expiryDate.setFullYear(expiryDate.getFullYear() + years);
      return { startDate, expiryDate, source: 'regex' };
    }
  }

  match = termStr.match(/from(?: and including)? (\d{1,2}) ([A-Za-z]+) (\d{4}) (?:to|until|ending on|expiring on|and ending on)(?: and including)? (\d{1,2}) ([A-Za-z]+) (\d{4})/i);
  if (match) {
    const startDate = new Date(`${match[1]} ${match[2]} ${match[3]}`);
    const expiryDate = new Date(`${match[4]} ${match[5]} ${match[6]}`);
    if (!isNaN(startDate) && !isNaN(expiryDate)) {
      return { startDate, expiryDate, source: 'regex' };
    }
  }

  match = termStr.match(/^[\s\u00A0]*(\d{1,4})[ \u00A0]*years?[ \u00A0]+from[ \u00A0]+(\d{1,2})[ \u00A0]+([A-Za-z]+)[ \u00A0]+(\d{4})/i);
  if (match) {
    const years = parseInt(match[1], 10);
    const startDate = new Date(`${match[2]} ${match[3]} ${match[4]}`);
    if (!isNaN(startDate)) {
      const expiryDate = new Date(startDate);
      expiryDate.setFullYear(expiryDate.getFullYear() + years);
      return { startDate, expiryDate, source: 'regex' };
    }
  }


  try {
    const response = await openai.responses.parse({
      model: config.openai.model,
      input: [
        {
          role: "system",
          content: `Extract the start and expiry dates from this lease term.
Return the result as JSON in the format:
{ "startDate": "YYYY-MM-DD", "expiryDate": "YYYY-MM-DD" }.`,
        },
        {
          role: "user",
          content: `Lease term: "${termStr}"`,
        },
      ],
      text: {
        format: zodTextFormat(LeaseTermSchema, "leaseTerm"),
      },
    });

    const { startDate, expiryDate } = response.output_parsed;

    LeaseTermCache.create({
      term: termStr,
      startDate: new Date(startDate),
      expiryDate: new Date(expiryDate),
      model: config.openai.model,
    }).catch(err => {
      console.warn('Failed to cache AI-parsed lease term:', err.message);
    });

    return {
      startDate: new Date(startDate),
      expiryDate: new Date(expiryDate),
      source: 'ai'
    };
  } catch (err) {
    console.warn(`AI lease term parsing failed for "${termStr}"`, err.message);
  }

  return null;
}

// ─────────────────────────────────────────────
// 📖 Lease Details View
// ─────────────────────────────────────────────
export async function show(req, res) {
  try {
    const uniqueId = req.params.id;
    const user = await User.findById(req.session.userId);

    if (!req.session.searchedLeases) {
      req.session.searchedLeases = [];
    }

    const isBookmarked = user.isLeaseBookmarked(uniqueId);
    const alreadyViewedThisSession = req.session.searchedLeases.includes(uniqueId);

    if (!isBookmarked && !alreadyViewedThisSession) {
      const hasAccess = await user.hasCredit();
      if (!hasAccess) {
        return res.status(403).render('error', {
          error: 'You have reached your daily lease view limit.'
        });
      }

      req.session.searchedLeases.push(uniqueId);
      await user.incrementLeaseViews();
    }

    await LeaseViewStat.recordView(uniqueId);

    // Fetch the current version of the lease
    const trackerEntry = await LeaseTracker.findOne({ uid: uniqueId }).lean();
    const currentVersion = trackerEntry?.lastUpdated || null;

    // Update versionViewed in bookmark if already bookmarked
    let isUpdated = false;
    if (isBookmarked && currentVersion) {
      const bookmark = user.bookmarks.find(b => b.uid === uniqueId);
      if (bookmark) {
        isUpdated = bookmark.versionViewed !== currentVersion;
        if (bookmark.versionViewed !== currentVersion) {
          bookmark.versionViewed = currentVersion;
          await user.save();
        }
      }
    }

    const rawleases = await Lease.find({ 'uid': uniqueId })
      .sort({ 'ro': 1, 'apid': 1 })
      .lean();

    if (!rawleases || rawleases.length === 0) {
      return res.status(404).render('error', { error: 'No leases found for this Unique Identifier' });
    }

    const leases = Lease.remapLeases(rawleases);

    const canBookmark = !isBookmarked && user.bookmarks.length < config.bookmarks.limit;

    res.render('lease-details', {
      leases,
      uniqueId,
      isBookmarked,
      canBookmark,
      currentVersion,
      isUpdated // <-- add this
    });

  } catch (error) {
    console.error('Lease details error:', error);
    res.status(500).render('error', { error: 'Failed to load lease details' });
  }
}

function formatHumanTerm(years, months, days) {
  const parts = [];
  if (years) parts.push(`${years} Year${years !== 1 ? 's' : ''}`);
  if (months) parts.push(`${months} Month${months !== 1 ? 's' : ''}`);
  if (days || parts.length === 0) parts.push(`${days} Day${days !== 1 ? 's' : ''}`);
  return parts.join(' ');
}

// ─────────────────────────────────────────────
// ⭐ Derive Term via AJAX
// ─────────────────────────────────────────────
export async function deriveTerm(req, res) {
  const { term } = req.body;
  if (!term) return res.status(400).json({ error: 'Missing term' });

  try {
    const parsed = await parseLeaseTerm(term);
    if (!parsed?.expiryDate) return res.status(200).json({ remainingTerm: null, expiryDate: null, source: null });

    const now = new Date();
    let diff = parsed.expiryDate - now;
    let remainingTerm = 'Expired';
    if (diff > 0) {
      let years = parsed.expiryDate.getFullYear() - now.getFullYear();
      let months = parsed.expiryDate.getMonth() - now.getMonth();
      let days = parsed.expiryDate.getDate() - now.getDate();

      if (days < 0) {
        months--;
        days += new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      }
      if (months < 0) {
        years--;
        months += 12;
      }

      remainingTerm = formatHumanTerm(years, months, days);
    }

    res.json({
      remainingTerm,
      expiryDate: parsed.expiryDate.toISOString().split('T')[0],
      source: parsed.source || 'ai'
    });
  } catch (err) {
    console.error('derive-term error:', err.message);
    res.status(500).json({ error: 'Failed to derive term' });
  }
}

// ─────────────────────────────────────────────
// 📌 Bookmark
// ─────────────────────────────────────────────
export async function bookmark(req, res) {
  try {
    const user = await User.findById(req.session.userId);
    await user.bookmarkLease(req.params.id);
    res.redirect(`/app/lease/${req.params.id}`);
  } catch (error) {
    console.error('Bookmark error:', error);
    res.status(400).render('error', { error: error.message || 'Failed to bookmark lease' });
  }
}


// ❌ Unbookmark
export async function unbookmark(req, res) {
  try {
    const user = await User.findById(req.session.userId);
    user.bookmarks = user.bookmarks.filter(id => id.toString() !== req.params.id);
    await user.save();
    res.redirect(`/app/lease/${req.params.id}`);
  } catch (error) {
    console.error('Unbookmark error:', error);
    res.status(500).render('error', { error: 'Failed to remove bookmark' });
  }
}