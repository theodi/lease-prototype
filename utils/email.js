import nodemailer from 'nodemailer';
import config from '../config/index.js';
import Lease from '../models/Lease.js';

function createTransporter() {
  const { host, port, user, pass } = config.email;

  const baseOptions = {
    host,
    port,
    secure: port === 465, // only use true for SSL (usually port 465)
    tls: {
      rejectUnauthorized: false // optional, for relaxed certs
    }
  };

  if (user && pass) {
    baseOptions.auth = {
      user,
      pass
    };
  }

  return nodemailer.createTransport(baseOptions);
}

export const transporter = createTransporter();

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
    from: `"Lease Finder Tool" <${config.email.from}>`,
    to: user.email,
    subject: `🔔 Lease Updates in ${latestVersion}`,
    html
  };

  await transporter.sendMail(mailOptions);
}

export async function sendSarEmail(user) {
  const jsonData = JSON.stringify(user, null, 2);

  const explanation = `
Hello,

As requested, here is a copy of the data we hold for your account.

------------------------------------------------------
Email Address: ${user.email}
Account Created: ${new Date(user.createdAt).toLocaleString()}
Last Login: ${new Date(user.lastLogin).toLocaleString()}
Login Count: ${user.loginCount}
IP Addresses Used:
${(user.loginHistory || []).map(l => `- ${l.ipAddress} (${new Date(l.timestamp).toLocaleString()})`).join('\n')}

Bookmarks:
${(user.bookmarks || []).map(b => `- ${b.uid} (last viewed version: ${b.versionViewed})`).join('\n')}

Lease Update Notifications: ${user.receiveLeaseUpdateEmails ? 'Enabled' : 'Disabled'}
Last SAR Request: ${user.lastSarRequestAt ? new Date(user.lastSarRequestAt).toLocaleString() : 'Never'}
------------------------------------------------------

This data is also attached as a JSON file for your reference.

Regards,
The Lease Finder Team
`;

  const mailOptions = {
    from: `"Lease Finder Tool" <${config.email.from}>`,
    to: user.email,
    subject: 'Your Subject Access Request (SAR) Data',
    text: explanation,
    attachments: [{
      filename: 'your-data.json',
      content: jsonData,
      contentType: 'application/json'
    }]
  };

  await transporter.sendMail(mailOptions);
}
