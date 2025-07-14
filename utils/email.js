import nodemailer from 'nodemailer';
import config from '../config/index.js';
import Lease from '../models/Lease.js';

export const transporter = nodemailer.createTransport({
  service: config.email.service,
  auth: {
    user: config.email.user,
    pass: config.email.pass
  }
});

export async function sendBookmarkUpdateEmail(user, updatedLeases, latestVersion) {
  if (!user.email || updatedLeases.length === 0) return;

  const uids = updatedLeases.map(l => l.uid);

  // Fetch latest lease entries for display purposes
  const leases = await Lease.aggregate([
    { $match: { uid: { $in: uids } } },
    { $sort: { uid: 1, ro: -1 } },
    {
      $group: {
        _id: '$uid',
        lease: { $first: '$$ROOT' }
      }
    },
    { $replaceRoot: { newRoot: '$lease' } },
    {
      $project: {
        uid: 1,
        rpd: 1
      }
    }
  ]);

  const leaseMap = new Map(leases.map(l => [l.uid, l.rpd || '(no description)']));

  const propertyList = updatedLeases
    .map(l => {
      const rpd = leaseMap.get(l.uid) || l.uid;
      return `<li><strong>${rpd}</strong></li>`;
    })
    .join('');

  const html = `
  <h1>Lease Updates Available</h1>
  <p>Some of the leases you've bookmarked have been updated in the <strong>${latestVersion}</strong> dataset:</p>
  <ul>${propertyList}</ul>
  <p><a href="${config.baseUrl}/app">View your bookmarks</a> to see the latest data.</p>
  <hr>
  <p style="font-size: 0.9em; color: #555;">
    This alert was sent because you previously bookmarked these leases.<br>
    You will only receive one email per update cycle.
  </p>
  <p style="font-size: 0.9em; color: #555;">
    Want to stop receiving these alerts? <a href="${config.baseUrl}/profile">Manage your email preferences</a>.
  </p>
`;


  const mailOptions = {
    from: `"Lease Finder Tool" <${config.email.user}>`,
    to: user.email,
    subject: `🔔 Lease Updates in ${latestVersion}`,
    html
  };

  await transporter.sendMail(mailOptions);
}