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
// 🔧 Load Tracking and Concurrency Control
// ─────────────────────────────────────────────

// Load tracking state
let activeSearches = 0;
let queuedSearches = 0;
let searchLatencies = [];
let overloadMode = false;
let lastLoadUpdate = Date.now();

// Rate limiting for failed queries
let failedQueries = new Map(); // query -> { count: number, lastAttempt: timestamp }

// Concurrency semaphore
let availableSlots = config.search.maxConcurrentSearches;

// Update load metrics
function updateLoadMetrics(latency) {
  const now = Date.now();
  
  // Add latency to rolling window
  searchLatencies.push({ latency, timestamp: now });
  if (searchLatencies.length > config.search.loadTracking.latencyWindowSize) {
    searchLatencies.shift();
  }
  
  // Calculate p95 latency
  const recentLatencies = searchLatencies
    .filter(l => now - l.timestamp < config.search.loadTracking.latencyWindowMinutes * 60 * 1000)
    .map(l => l.latency)
    .sort((a, b) => a - b);
  
  const p95Latency = recentLatencies.length > 0 
    ? recentLatencies[Math.floor(recentLatencies.length * 0.95)]
    : 0;
  
  // Determine overload mode
  overloadMode = activeSearches > config.search.overloadThreshold.activeSearches || 
                 p95Latency > config.search.overloadThreshold.p95Latency;
  
  lastLoadUpdate = now;
}

// Get current load status
export function getLoadStatus() {
  const now = Date.now();
  const recentLatencies = searchLatencies
    .filter(l => now - l.timestamp < config.search.loadTracking.latencyWindowMinutes * 60 * 1000)
    .map(l => l.latency);
  
  const p95Latency = recentLatencies.length > 0 
    ? recentLatencies.sort((a, b) => a - b)[Math.floor(recentLatencies.length * 0.95)]
    : 0;
  
  return {
    active: activeSearches,
    queued: queuedSearches,
    availableSlots,
    p95Latency,
    overload: overloadMode,
    lastUpdate: lastLoadUpdate
  };
}

// ─────────────────────────────────────────────
// 🔍 Lease Search
// ─────────────────────────────────────────────
export async function lookup(req, res) {
  const startTime = Date.now();
  const { query } = req.query;
  
  // Check rate limiting for failed queries
  const now = Date.now();
  const failedQuery = failedQueries.get(query);
  if (failedQuery && failedQuery.count >= config.search.rateLimiting.maxFailedAttempts) {
    const timeSinceLastAttempt = now - failedQuery.lastAttempt;
    if (timeSinceLastAttempt < config.search.rateLimiting.failedQueryResetTime) {
      return res.status(429).json({ 
        error: 'Query rate limited', 
        retryAfter: Math.ceil((config.search.rateLimiting.failedQueryResetTime - timeSinceLastAttempt) / 1000),
        message: 'This search query has failed too many times. Please try a different search term or wait a moment.'
      });
    } else {
      // Reset the failed query count after timeout
      failedQueries.delete(query);
    }
  }
  
  // Check concurrency limit
  if (availableSlots <= 0) {
    queuedSearches++;
    return res.status(429).json({ 
      error: 'Server at capacity', 
      retryAfter: 2,
      message: 'Too many concurrent searches. Please try again in a moment.'
    });
  }
  
  // Acquire slot
  availableSlots--;
  activeSearches++;
  
  // Create an AbortController for this request
  const abortController = new AbortController();
  
  // Set up request cleanup on client disconnect
  req.on('close', () => {
    abortController.abort();
  });

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

    // First try to match a complete postcode pattern (outward + 2 letters)
    const completePostcodeRegex = /\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b/i;
    let match = query.match(completePostcodeRegex);
    let isCompletePostcode = false;
    let searchTerm = null;
    let outward = null;
    let inward = null;
    let isValidPartialPostcode = false;
    let hasInvalidInward = false;
    
    if (match) {
      isCompletePostcode = true;
      outward = match[1].toUpperCase();
      inward = match[2].toUpperCase();
      searchTerm = outward + ' ' + inward;
    } else {
      // If no complete postcode, try partial postcode pattern
      const partialPostcodeRegex = /\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*([A-Z0-9]*)?\b/i;
      match = query.match(partialPostcodeRegex);
      if (match) {
        outward = match[1].toUpperCase();
        inward = match[2] ? match[2].toUpperCase() : null;
        searchTerm = outward + ' ' + inward;
        isCompletePostcode = false;
        // Check if this looks like a valid partial postcode (outward + partial inward that could be valid)
        isValidPartialPostcode = !isCompletePostcode && inward && inward.length <= 2 && /^[A-Z0-9]+$/.test(inward);
        //console.log('isValidPartialPostcode', isValidPartialPostcode);
        
        // Check if this is outward + something that's not a valid inward pattern
        hasInvalidInward = inward && !/^[A-Z0-9]+$/.test(inward);
        //console.log('hasInvalidInward', hasInvalidInward);
      }
    }
    
    let results = [];

    if (isCompletePostcode) {
        // ✅ Full postcode match — return all results with this postcode
        // console.log('Full postcode match');
        SearchAnalytics.incrementSearchType('full_postcode');
        const fullPostcode = `${searchTerm}`;
        // console.log(`Searching full postcode: "${fullPostcode}"`);
        // Check if request was aborted before database query
        if (abortController.signal.aborted) {
          return res.status(499).json({ error: 'Request cancelled' });
        }
        
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
        ], { 
          signal: abortController.signal,
          maxTimeMS: config.search.maxTimeMS
        });
    } else if (isValidPartialPostcode) {
           //console.log('Partial postcode match');
           // 🟡 Partial postcode — use Atlas Search for autocomplete
           SearchAnalytics.incrementSearchType('partial_postcode');
           
           // Check if request was aborted before database query
           if (abortController.signal.aborted) {
             return res.status(499).json({ error: 'Request cancelled' });
           }
           
           const searchTerm = query.trim().toUpperCase();
           //console.log(`Searching partial postcode: "${searchTerm}"`);
           
           results = await Lease.aggregate([
             {
               $search: {
                 index: 'postcode_autocomplete',
                 compound: {
                   must: [
                     {
                       text: {
                         query: outward,
                         path: 'pc'
                       }
                     },
                     {
                       wildcard: {
                         query: `${searchTerm}*`,
                         path: 'pc',
                         allowAnalyzedField: true
                       }
                     }
                   ]
                 }
               }
             },
             {
               $group: {
                 _id: '$uid',
                 lease: { $first: '$$ROOT' }
               }
             },
             { $replaceRoot: { newRoot: '$lease' } },
             { $limit: 50 },
             {
               $project: {
                 _id: 0,
                 uid: 1,
                 rpd: 1,
                 apd: 1,
                 pc: 1
               }
             }
           ], { 
             signal: abortController.signal,
             maxTimeMS: config.search.maxTimeMS
           });
           
    } else if (hasInvalidInward) {
             //console.log('Outer postcode with invalid inward - treating as outward only');
             // 🟡 Outer postcode with invalid inward — use outward only for postcode search
             SearchAnalytics.incrementSearchType('outer_postcode');
             
             // Check if request was aborted before database query
             if (abortController.signal.aborted) {
               return res.status(499).json({ error: 'Request cancelled' });
             }
             
             //console.log(`Searching outer postcode: "${outward}" (ignoring invalid inward: "${inward}")`);
             
             results = await Lease.aggregate([
               {
                 $search: {
                   index: 'postcode_autocomplete',
                   compound: {
                     must: [
                       {
                         text: {
                           query: outward,
                           path: 'pc'
                         }
                       }
                     ],
                     filter: [
                       {
                         wildcard: {
                           path: 'pc',
                           query: `${outward}*`,
                           allowAnalyzedField: true
                         }
                       }
                     ]
                   }
                 }
               },
               {
                 $group: {
                   _id: '$uid',
                   lease: { $first: '$$ROOT' }
                 }
               },
               { $replaceRoot: { newRoot: '$lease' } },
               { $limit: 50 },
               {
                 $project: {
                   _id: 0,
                   uid: 1,
                   rpd: 1,
                   apd: 1,
                   pc: 1
                 }
               }
             ], { 
               signal: abortController.signal,
               maxTimeMS: config.search.maxTimeMS
             });
           
    } else if (outward && !inward) {
           //console.log('Outer postcode only');
           // 🟡 Outer postcode only — use regex for exact prefix matching
           SearchAnalytics.incrementSearchType('outer_postcode');
           
           // Check if request was aborted before database query
           if (abortController.signal.aborted) {
             return res.status(499).json({ error: 'Request cancelled' });
           }
           
           //console.log(`Searching outer postcode: "${outward}"`);
           
           results = await Lease.aggregate([
             {
               $search: {
                 index: 'postcode_autocomplete',
                 compound: {
                   must: [
                     {
                       text: {
                         query: outward,
                         path: 'pc'
                       }
                     }
                   ],
                   filter: [
                     {
                       wildcard: {
                         path: 'pc',
                         query: `${outward}*`,
                         allowAnalyzedField: true
                       }
                     }
                   ]
                 }
               }
             },
             {
               $group: {
                 _id: '$uid',
                 lease: { $first: '$$ROOT' }
               }
             },
             { $replaceRoot: { newRoot: '$lease' } },
             { $limit: 50 },
             {
               $project: {
                 _id: 0,
                 uid: 1,
                 rpd: 1,
                 apd: 1,
                 pc: 1
               }
             }
           ], { 
             signal: abortController.signal,
             maxTimeMS: config.search.maxTimeMS
           });
    } else {
      //console.log('Autocomplete search');
      SearchAnalytics.incrementSearchType('autocomplete');
      // 🔍 Autocomplete search — check results before falling back
      
      // Check if request was aborted before database query
      if (abortController.signal.aborted) {
        return res.status(499).json({ error: 'Request cancelled' });
      }
      
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
        { $limit: 50 },
        {
          $project: {
            _id: 0,
            uid: 1,
            rpd: 1,
            apd: 1,
            pc: 1
          }
        }
      ], { 
        signal: abortController.signal,
        maxTimeMS: config.search.maxTimeMS
      });

      const containsQuery = autoResults.some(r =>
        (r.rpd || '').toLowerCase().includes(query.toLowerCase()) ||
        (r.apd || '').toLowerCase().includes(query.toLowerCase())
      );

      if (autoResults.length > 0 && containsQuery) {
        results = autoResults.slice(0, 5); // limit to 5 manually
      } else {
        // 🔁 Fallback to default index search
        SearchAnalytics.incrementSearchType('fallback');
        //console.log('Fallback to default index search');
        
        // Check if request was aborted before fallback query
        if (abortController.signal.aborted) {
          return res.status(499).json({ error: 'Request cancelled' });
        }
        
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
          { $limit: 50 },
          {
            $project: {
              _id: 0,
              uid: 1,
              rpd: 1,
              apd: 1,
              pc: 1
            }
          }
        ], { 
          signal: abortController.signal,
          maxTimeMS: config.search.maxTimeMS
        });
      }
    }

    // Final check before sending response
    if (abortController.signal.aborted) {
      return res.status(499).json({ error: 'Request cancelled' });
    }

    // Update load metrics
    const latency = Date.now() - startTime;
    updateLoadMetrics(latency);

    // Add load headers to response
    res.set({
      'X-Search-Load': overloadMode ? 'high' : 'normal',
      'X-Search-Active': activeSearches.toString(),
      'X-Search-Available': availableSlots.toString(),
      'X-Search-P95': Math.round(latency).toString()
    });

    res.json(results.map(mapLeaseToVirtual));
  } catch (error) {
    // Handle aborted requests gracefully
    if (error.name === 'AbortError' || abortController.signal.aborted) {
      //console.log('Lease lookup request was cancelled');
      return res.status(499).json({ error: 'Request cancelled' });
    }
    
    // Handle MongoDB timeout errors (MaxTimeMSExpired)
    if (error.code === 50 || error.codeName === 'MaxTimeMSExpired' || 
        (error.message && error.message.includes('exceeded time limit'))) {
      //console.log('Search query timed out (MaxTimeMSExpired)');
      
      // Track failed query
      const failedQuery = failedQueries.get(query) || { count: 0, lastAttempt: 0 };
      failedQuery.count++;
      failedQuery.lastAttempt = Date.now();
      failedQueries.set(query, failedQuery);
      
      // Clean up old failed queries
      for (const [key, value] of failedQueries.entries()) {
        if (Date.now() - value.lastAttempt > config.search.rateLimiting.failedQueryResetTime) {
          failedQueries.delete(key);
        }
      }
      
      return res.status(408).json({ 
        error: 'Search timeout',
        message: 'Search took too long. This is likely due to your search being very gerenal, e.g. just the start of a postcode or a partial address. Please try a more specific query or a different search term, such as full postcode, or start or specific address, e.g. 112 Market Street.'
      });
    }
    
    // Handle MongoDB connection errors
    if (error.name === 'MongoNetworkError' || error.message.includes('ECONNREFUSED')) {
      console.error('Database connection error:', error);
      return res.status(503).json({ 
        error: 'Service temporarily unavailable',
        message: 'The search service is temporarily unavailable. Please try again in a moment.'
      });
    }
    
    // Handle other MongoDB query errors
    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
      //console.log('Database query error:', error.message || error.codeName || 'Unknown MongoDB error');
      return res.status(503).json({ 
        error: 'Search service error',
        message: 'There was a problem with the search service. Please try again.'
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      //console.log('Validation error:', error.message);
      return res.status(400).json({ 
        error: 'Invalid search query',
        message: 'Please check your search terms and try again.'
      });
    }
    
    //console.log('Lease lookup error:', error.message || 'Unknown error');
    res.status(500).json({ 
      error: 'Search failed',
      message: 'An unexpected error occurred. Please try again or contact support if the problem persists.'
    });
  } finally {
    // Always release slot and update metrics
    availableSlots++;
    activeSearches--;
    if (queuedSearches > 0) {
      queuedSearches--;
    }
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