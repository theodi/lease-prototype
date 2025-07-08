// models/LeaseViewStat.js
import mongoose from 'mongoose';

const leaseViewStatSchema = new mongoose.Schema({
  uniqueId: {
    type: String,
    required: true,
    unique: true
  },
  viewCount: {
    type: Number,
    default: 0
  },
  lastViewedAt: {
    type: Date,
    default: null
  }
});

// Static method to increment view count
leaseViewStatSchema.statics.recordView = async function (uniqueId) {
  return this.findOneAndUpdate(
    { uniqueId },
    {
      $inc: { viewCount: 1 },
      $set: { lastViewedAt: new Date() }
    },
    { upsert: true, new: true }
  );
};

export default mongoose.model('LeaseViewStat', leaseViewStatSchema);