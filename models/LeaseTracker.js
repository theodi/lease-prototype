// models/LeaseTracker.js
import mongoose from 'mongoose';

const leaseTrackerSchema = new mongoose.Schema({
  uid: {
    type: String,
    required: true,
    unique: true
  },
  lastUpdated: {
    type: String, // Format: 'YYYY-MM'
    required: true
  }
});

leaseTrackerSchema.statics.upsertLastUpdated = async function(uid, lastUpdated) {
  await this.updateOne(
    { uid },
    { $set: { lastUpdated } },
    { upsert: true }
  );
};

export default mongoose.model('LeaseTracker', leaseTrackerSchema);