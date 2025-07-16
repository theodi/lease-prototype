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
  },
  changedFields: {
    type: [String], // Array of field names that changed
    default: []
  }
});

leaseTrackerSchema.statics.upsertLastUpdated = async function(uid, lastUpdated, changedFields = []) {
  await this.updateOne(
    { uid },
    { $set: { lastUpdated, changedFields } },
    { upsert: true }
  );
};

export default mongoose.model('LeaseTracker', leaseTrackerSchema);