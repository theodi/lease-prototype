import mongoose from 'mongoose';

const bugReportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email: { type: String, required: true },
  description: { type: String, required: true },
  pageUrl: { type: String },
  screenshot: { type: String }, // filename or path if uploaded
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('BugReport', bugReportSchema);