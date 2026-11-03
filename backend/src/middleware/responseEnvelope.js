function responseEnvelope(req, res, next) {
  res.envelope = (data, meta) => {
    const body = { data };
    if (meta) body.meta = meta;
    return res.json(body);
  };
  next();
}

module.exports = responseEnvelope;
