import mongoose from 'mongoose';
import 'dotenv/config.js';
import config from './config/index.js';
import User from './models/User.js';
import LeaseTracker from './models/LeaseTracker.js';
import LeaseUpdateLog from './models/LeaseUpdateLog.js';
import { sendBookmarkUpdateEmail } from './utils/email.js';

async function sendUpdateEmails(latestVersion) {
  const batchSize = 10;
  let skip = 0;
  let processed = 0;

  while (true) {
    const users = await User.find()
      .skip(skip)
      .limit(batchSize)
      .select('email bookmarks receiveLeaseUpdateEmails leaseUpdateEmailsSent')
      .lean();

    if (users.length === 0) break;

    for (const user of users) {
      if (user.receiveLeaseUpdateEmails === false) continue;
      if (user.leaseUpdateEmailsSent?.includes(latestVersion)) continue;

      const bookmarks = user.bookmarks || [];
      const uidToViewed = new Map(bookmarks.map(b => [b.uid, b.versionViewed]));

      if (uidToViewed.size === 0) continue;

      const trackers = await LeaseTracker.find({
        uid: { $in: Array.from(uidToViewed.keys()) }
      }).lean();

      const staleLeases = trackers.filter(t => {
        const viewed = uidToViewed.get(t.uid);
        return viewed && t.lastUpdated !== viewed;
      });

      if (staleLeases.length > 0) {
        await sendBookmarkUpdateEmail(user, staleLeases, latestVersion);

        // Update user to record the email has been sent
        await User.updateOne(
          { _id: user._id },
          { $addToSet: { leaseUpdateEmailsSent: latestVersion } }
        );

        console.log(`📬 Email sent to ${user.email}`);
      }

      processed++;
    }

    skip += batchSize;
  }

  console.log(`✅ Finished. Processed ${processed} users for version ${latestVersion}`);
}

async function loop() {
  await mongoose.connect(config.mongodbUri);
  console.log('🔌 Connected to MongoDB');

  while (true) {
    try {
      const latestVersion = await LeaseUpdateLog.getLatestVersion();
      if (!latestVersion) {
        console.warn('⚠️ No lease update version found. Retrying in 24h.');
      } else {
        console.log(`🚀 Starting email update cycle for version: ${latestVersion}`);
        await sendUpdateEmails(latestVersion);
      }
    } catch (err) {
      console.error('❌ Error during email update cycle:', err);
    }
    // Wait 24 hours before the next cycle
    const hours = 24;
    const delay = hours * 60 * 60 * 1000;
    console.log(`⏳ Waiting ${hours} hours until next cycle...`);
    await new Promise(res => setTimeout(res, delay));
    /*
    const minutes = 1;
    const delay = minutes * 60 * 1000;
    console.log(`⏳ Waiting ${minutes} minute until next cycle...`);
    await new Promise(res => setTimeout(res, delay));
    */
  }
}

loop().catch(err => {
  console.error('❌ Fatal error in main loop:', err);
  process.exit(1);
});