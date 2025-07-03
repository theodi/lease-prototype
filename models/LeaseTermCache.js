import mongoose from 'mongoose';

const LeaseTermCacheSchema = new mongoose.Schema({
  term: { type: String, required: true, unique: true }, // Original lease term string
  startDate: { type: Date },
  expiryDate: { type: Date },
  model: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const LeaseTermCache = mongoose.model('LeaseTermCache', LeaseTermCacheSchema);

export default LeaseTermCache;