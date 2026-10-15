process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-32-characters-xx";
process.env.BCRYPT_COST = "4";
// Encryption is on for every test. Fixed throwaway keys, not used anywhere else.
process.env.FIELD_ENCRYPTION_KEYS = "t1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
process.env.FIELD_ENCRYPTION_KEY_ID = "t1";
process.env.FIELD_HASH_KEY = "ZmllbGQtaGFzaC1rZXktZm9yLXRlc3RzLTMyLWJ5dGVzIQ==";
