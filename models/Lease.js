import mongoose from 'mongoose';

const leaseSchema = new mongoose.Schema({
  'Unique Identifier': { type: String, index: true },
  'Tenure': String,
  'Register Property Description': { type: String, index: true },
  'County': String,
  'Region': String,
  'Associated Property Description ID': Number,
  'Associated Property Description': { type: String, index: true },
  'Postcode': { type: String, index: true },
  'OS UPRN': Number,
  'Price Paid': String,
  'Reg Order': Number,
  'Date of Lease': String,
  'Term': String,
  'Alienation Clause Indicator': String
}, {
  timestamps: true
});

leaseSchema.index({
  'Register Property Description': 'text',
  'Associated Property Description': 'text'
});

const Lease = mongoose.model('Lease', leaseSchema);

export default Lease;