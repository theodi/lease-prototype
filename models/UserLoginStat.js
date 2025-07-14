// models/UserLoginStat.js
import mongoose from 'mongoose';

const userLoginStatSchema = new mongoose.Schema({
  period: {
    type: String, // 'YYYY-MM-DD', 'YYYY-MM', or 'YYYY'
    required: true,
    unique: true
  },
  count: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

export default mongoose.model('UserLoginStat', userLoginStatSchema);