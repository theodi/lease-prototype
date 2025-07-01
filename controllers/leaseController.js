const Lease = require('../models/Lease');
const User = require('../models/User');

// Fuzzy search for leases by address using Atlas Search
exports.lookup = async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.length < 3) {
            return res.json([]); // Require at least 3 chars for search
        }
        // Use Atlas Search aggregation, then group by Unique Identifier and pick highest Reg Order
        const results = await Lease.aggregate([
            {
                $search: {
                    index: 'default',
                    text: {
                        query: query,
                        path: ['Register Property Description', 'Associated Property Description']
                    }
                }
            },
            { $sort: { 'Unique Identifier': 1, 'Reg Order': -1 } },
            {
                $group: {
                    _id: '$Unique Identifier',
                    lease: { $first: '$$ROOT' }
                }
            },
            { $replaceRoot: { newRoot: '$lease' } },
            { $limit: 5 }
        ]);
        res.json(results);
    } catch (error) {
        console.error('Lease lookup error:', error);
        res.status(500).json({ error: 'Failed to lookup lease' });
    }
};

function parseLeaseTerm(termStr) {
    // Pattern 1: X years from D Month YYYY
    let match = termStr.match(/^[\s\u00A0]*(\d{1,4})[ \u00A0]*years?(?:[ \u00A0]+from[ \u00A0]+(\d{1,2})[ \u00A0]+([A-Za-z]+)[ \u00A0]+(\d{4}))/i);
    if (match) {
        const years = parseInt(match[1], 10);
        const startDate = new Date(`${match[2]} ${match[3]} ${match[4]}`);
        if (!isNaN(startDate)) {
            const expiryDate = new Date(startDate);
            expiryDate.setFullYear(expiryDate.getFullYear() + years);
            return { startDate, expiryDate };
        }
    }
    // Pattern 2: from D Month YYYY to/until D Month YYYY
    match = termStr.match(/from(?: and including)? (\d{1,2}) ([A-Za-z]+) (\d{4}) (?:to|until)(?: and including)? (\d{1,2}) ([A-Za-z]+) (\d{4})/i);
    if (match) {
        const startDate = new Date(`${match[1]} ${match[2]} ${match[3]}`);
        const expiryDate = new Date(`${match[4]} ${match[5]} ${match[6]}`);
        if (!isNaN(startDate) && !isNaN(expiryDate)) {
            return { startDate, expiryDate };
        }
    }
    // Pattern 3: fallback to just X years (no date)
    match = termStr.match(/^[\s\u00A0]*(\d{1,4})[ \u00A0]*years?/i);
    if (match) {
        return { years: parseInt(match[1], 10) };
    }
    return null;
}

/*
// Show lease details and count as a view against quota (unless bookmarked)
exports.show = async (req, res) => {
    try {
        const lease = await Lease.findById(req.params.id).lean();
        if (!lease) {
            return res.status(404).render('error', { error: 'Lease not found' });
        }
        const user = await User.findById(req.session.userId);
        const isBookmarked = user.isLeaseBookmarked(lease._id);
        // Only count against quota if not bookmarked
        if (!isBookmarked) {
            await user.addSearch(lease['Register Property Description'] || lease['Associated Property Description'] || lease._id, false);
        }
        // Calculate Remaining Term and Expiry Date if possible
        let remainingTerm = null;
        let expiryDate = null;
        let startDate = null;
        if (lease['Term']) {
            const parsed = parseLeaseTerm(lease['Term']);
            if (parsed) {
                if (parsed.expiryDate) {
                    expiryDate = parsed.expiryDate;
                    startDate = parsed.startDate;
                } else if (parsed.years) {
                    // No start date, can't calculate expiry
                }
            }
            if (expiryDate) {
                const now = new Date();
                let diff = expiryDate - now;
                if (diff > 0) {
                    let yearsLeft = expiryDate.getFullYear() - now.getFullYear();
                    let monthsLeft = expiryDate.getMonth() - now.getMonth();
                    let daysLeft = expiryDate.getDate() - now.getDate();
                    if (daysLeft < 0) {
                        monthsLeft--;
                        daysLeft += new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                    }
                    if (monthsLeft < 0) {
                        yearsLeft--;
                        monthsLeft += 12;
                    }
                    remainingTerm = `${yearsLeft} years, ${monthsLeft} months, ${daysLeft} days`;
                } else {
                    remainingTerm = 'Expired';
                }
            }
        }
        const remainingSearches = user.getRemainingSearches();
        // Insert remainingTerm and expiryDate after 'Term' key
        let leaseForView = {};
        for (const [key, value] of Object.entries(lease)) {
            leaseForView[key] = value;
            if (key === 'Term') {
                if (remainingTerm) leaseForView['Remaining Term'] = remainingTerm;
                if (expiryDate) {
                    const formattedExpiry = expiryDate instanceof Date ? expiryDate.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) : expiryDate;
                    leaseForView['Expiry Date'] = formattedExpiry;
                }
            }
        }
        leaseForView.isBookmarked = isBookmarked;
        res.render('lease-details', { lease: leaseForView, remainingSearches });
    } catch (error) {
        if (error.message === 'Daily search limit reached') {
            return res.status(400).render('error', { error: 'You have reached your daily view limit. Please try again tomorrow.' });
        }
        console.error('Lease details error:', error);
        res.status(500).render('error', { error: 'Failed to load lease details' });
    }
};
*/

// Bookmark a lease
exports.bookmark = async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        await user.bookmarkLease(req.params.id);
        res.redirect(`/app/lease/${req.params.id}`);
    } catch (error) {
        console.error('Bookmark error:', error);
        res.status(500).render('error', { error: 'Failed to bookmark lease' });
    }
};

// Unbookmark a lease
exports.unbookmark = async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        user.bookmarks = user.bookmarks.filter(id => id.toString() !== req.params.id);
        await user.save();
        res.redirect(`/app/lease/${req.params.id}`);
    } catch (error) {
        console.error('Unbookmark error:', error);
        res.status(500).render('error', { error: 'Failed to remove bookmark' });
    }
};

// Show all leases for a Unique Identifier, ordered by Reg Order
exports.show = async (req, res) => {
    try {
        const uniqueId = req.params.id;
        const user = await User.findById(req.session.userId);
        const isBookmarked = user.isLeaseBookmarked(uniqueId);
        // Only count against quota if not bookmarked
        if (!isBookmarked) {
            await user.addSearch(uniqueId, false);
        }
        const leases = await Lease.find({ 'Unique Identifier': uniqueId })
            .sort({ 'Reg Order': 1, 'Associated Property Description ID': 1 })
            .lean();
        if (!leases || leases.length === 0) {
            return res.status(404).render('error', { error: 'No leases found for this Unique Identifier' });
        }
        const leasesWithTerms = leases.map(lease => {
            let remainingTerm = null;
            let expiryDate = null;
            let startDate = null;
            if (lease['Term']) {
                const parsed = parseLeaseTerm(lease['Term']);
                if (parsed) {
                    if (parsed.expiryDate) {
                        expiryDate = parsed.expiryDate;
                        startDate = parsed.startDate;
                    } else if (parsed.years) {
                        // No start date, can't calculate expiry
                    }
                }
                // Calculate remaining term if expiryDate is present
                if (expiryDate) {
                    const now = new Date();
                    let diff = expiryDate - now;
                    if (diff > 0) {
                        let yearsLeft = expiryDate.getFullYear() - now.getFullYear();
                        let monthsLeft = expiryDate.getMonth() - now.getMonth();
                        let daysLeft = expiryDate.getDate() - now.getDate();
                        if (daysLeft < 0) {
                            monthsLeft--;
                            daysLeft += new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                        }
                        if (monthsLeft < 0) {
                            yearsLeft--;
                            monthsLeft += 12;
                        }
                        remainingTerm = `${yearsLeft} years, ${monthsLeft} months, ${daysLeft} days`;
                    } else {
                        remainingTerm = 'Expired';
                    }
                }
            }
            // Format expiry date as string if present
            let formattedExpiry = null;
            if (expiryDate) {
                formattedExpiry = expiryDate instanceof Date ? expiryDate.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) : expiryDate;
            }
            // Insert after 'Term' key
            let leaseForView = {};
            for (const [key, value] of Object.entries(lease)) {
                leaseForView[key] = value;
                if (key === 'Term') {
                    if (remainingTerm) leaseForView['Remaining Term'] = remainingTerm;
                    if (formattedExpiry) leaseForView['Expiry Date'] = formattedExpiry;
                }
            }
            return leaseForView;
        });
        res.render('lease-details', { leases: leasesWithTerms, uniqueId, isBookmarked });
    } catch (error) {
        console.error('Lease details error:', error);
        res.status(500).render('error', { error: 'Failed to load lease details' });
    }
}; 