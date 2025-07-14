import mongoose from 'mongoose';

const leaseUpdateLogSchema = new mongoose.Schema({
  version: {
    type: String, // Format: 'YYYY-MM'
    required: true,
    unique: true
  },
  appliedAt: {
    type: Date,
    default: Date.now
  },
  added: Number,
  deleted: Number,
  skipped: Number,
  manualReview: Number,
  notes: String // Optional notes or file info
});

leaseUpdateLogSchema.statics.getLatestVersion = async function() {
  const latest = await this.findOne().sort({ version: -1 }).lean();
  return latest?.version || null;
};

export default mongoose.model('LeaseUpdateLog', leaseUpdateLogSchema);