use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn sha256_hex(input: &str) -> String {
  let mut hasher = Sha256::new();
  hasher.update(input.as_bytes());
  let result = hasher.finalize();
  hex::encode(result)
}

pub fn hash_password(password: &str) -> String {
  sha256_hex(password)
}

pub fn verify_password(password: &str, hash: &str) -> bool {
  hash_password(password) == hash
}

pub fn random_string(len: usize) -> String {
  if len == 0 {
    return String::new();
  }
  let mut bytes = vec![0u8; len];
  rand::thread_rng().fill_bytes(&mut bytes);
  let encoded = URL_SAFE_NO_PAD.encode(bytes);
  encoded.chars().take(len).collect()
}

pub fn random_base64(len: usize) -> String {
  if len == 0 {
    return String::new();
  }
  let mut bytes = vec![0u8; len];
  rand::thread_rng().fill_bytes(&mut bytes);
  base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn random_numeric_code(len: usize) -> String {
  if len == 0 {
    return String::new();
  }
  let mut bytes = vec![0u8; len];
  rand::thread_rng().fill_bytes(&mut bytes);
  let mut out = String::with_capacity(len);
  for byte in bytes {
    out.push(char::from(b'0' + (byte % 10)));
  }
  out
}

pub fn generate_uuid() -> String {
  Uuid::new_v4().to_string()
}
