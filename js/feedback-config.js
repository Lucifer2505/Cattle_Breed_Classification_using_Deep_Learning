// Feedback settings. The Web3Forms access key is PUBLIC by design (it ships to every visitor).
// It can only send mail to the address you registered. Protect it in the Web3Forms dashboard
// (restrict allowed domains, enable captcha if your plan offers it) and rotate it if it is abused.
export const FEEDBACK_CONFIG = {
  endpoint: 'https://api.web3forms.com/submit',
  accessKey: 'f05d1d4c-02f3-4490-886b-9b9e0a1836c4',   // <- paste your key (a UUID) here
  subject: 'Cattle Breed Identifier feedback',
  fromName: 'Cattle Breed Identifier app',
  maxMessageChars: 1000,
  minFillMs: 2000,       // a human cannot realistically finish faster; submissions wait for this
  cooldownMs: 60000,     // one message per minute per browser tab
  timeoutMs: 15000,
};

export const isConfigured = () =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(FEEDBACK_CONFIG.accessKey);
