// models/SearchAnalytics.js
import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['full_postcode', 'outer_postcode', 'autocomplete', 'fallback'],
    required: true
  },
  count: {
    type: Number,
    default: 1
  },
  lastUsedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

schema.index({ type: 1 }, { unique: true });

// Static method to increment usage
schema.statics.incrementSearchType = async function (type) {
  try {
    await this.findOneAndUpdate(
      { type },
      {
        $inc: { count: 1 },
        $set: { lastUsedAt: new Date() }
      },
      { upsert: true }
    );
  } catch (err) {
    console.error('Analytics increment error:', err);
  }
};

export default mongoose.model('SearchAnalytics', schema);