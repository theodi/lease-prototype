import mongoose from 'mongoose';

const leaseSchema = new mongoose.Schema({
  uid: { type: String, index: true },
  rpd: String,
  cty: String,
  rgn: String,
  apid: Number,
  apd: String,
  uprn: Number,
  ppd: Number,
  ro: Number,
  dol: String,
  term: String,
  aci: String,
  pc: { type: String, index: true },
  start_date: Date,
  expiry_date: Date,
  tenure_years: Number
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

leaseSchema.virtual('Unique Identifier').get(function () {
  return this.uid;
});
leaseSchema.virtual('Register Property Description').get(function () {
  return this.rpd;
});
leaseSchema.virtual('County').get(function () {
  return this.cty;
});
leaseSchema.virtual('Region').get(function () {
  return this.rgn;
});
leaseSchema.virtual('Associated Property Description ID').get(function () {
  return this.apid;
});
leaseSchema.virtual('Associated Property Description').get(function () {
  return this.apd;
});
leaseSchema.virtual('OS UPRN').get(function () {
  return this.uprn;
});
leaseSchema.virtual('Price Paid').get(function () {
  return this.ppd;
});
leaseSchema.virtual('Reg Order').get(function () {
  return this.ro;
});
leaseSchema.virtual('Date of Lease').get(function () {
  return this.dol;
});
leaseSchema.virtual('Term').get(function () {
  return this.term;
});
leaseSchema.virtual('Alienation Clause Indicator').get(function () {
  return this.aci;
});
leaseSchema.virtual('Postcode').get(function () {
  return this.pc;
});
leaseSchema.virtual('Start Date').get(function () {
  if (!this.start_date) return null;
  const d = new Date(this.start_date);
  return d.toISOString().split('T')[0]; // Returns YYYY-MM-DD
});
leaseSchema.virtual('Expiry Date').get(function () {
  if (!this.expiry_date) return null;
  const d = new Date(this.expiry_date);
  return d.toISOString().split('T')[0]; // Returns YYYY-MM-DD
}); 
leaseSchema.virtual('Tenure Years').get(function () {
  return this.tenure_years;
});

// Static method to remap keys using virtual aliases
leaseSchema.statics.remapLeases = function (leases) {
  const formatDate = (d) => d ? new Date(d).toISOString().split('T')[0] : null;
  
  const mapOne = lease => ({
    '_id': lease._id,
    'Unique Identifier': lease.uid,
    'Register Property Description': lease.rpd,
    'County': lease.cty,
    'Region': lease.rgn,
    'Associated Property Description ID': lease.apid,
    'Associated Property Description': lease.apd,
    'OS UPRN': lease.uprn,
    'Price Paid': lease.ppd,
    'Reg Order': lease.ro,
    'Date of Lease': lease.dol,
    'Term': lease.term,
    'Alienation Clause Indicator': lease.aci,
    'Postcode': lease.pc,
    'Start Date': formatDate(lease.start_date),
    'Expiry Date': formatDate(lease.expiry_date),
    'Tenure Years': lease.tenure_years
  });

  if (Array.isArray(leases)) return leases.map(mapOne);
  return mapOne(leases);
};

const Lease = mongoose.model('Lease', leaseSchema);

export default Lease;