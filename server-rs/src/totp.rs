use data_encoding::BASE32_NOPAD;
use hmac::{Hmac, Mac};
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

pub fn verify_totp(secret_base32: &str, token: &str, window: i64) -> bool {
  let trimmed = token.trim();
  if trimmed.len() < 6 || !trimmed.chars().all(|c| c.is_ascii_digit()) {
    return false;
  }
  let secret = match BASE32_NOPAD.decode(secret_base32.trim().as_bytes()) {
    Ok(bytes) => bytes,
    Err(_) => return false
  };
  let now = chrono::Utc::now().timestamp();
  let step = 30i64;
  let counter = now / step;
  for offset in -window..=window {
    let value = counter + offset;
    if value < 0 {
      continue;
    }
    let code = hotp(&secret, value as u64, 6);
    if code == trimmed {
      return true;
    }
  }
  false
}

fn hotp(secret: &[u8], counter: u64, digits: u32) -> String {
  let mut mac = HmacSha1::new_from_slice(secret).unwrap_or_else(|_| HmacSha1::new_from_slice(&[]).unwrap());
  mac.update(&counter.to_be_bytes());
  let result = mac.finalize().into_bytes();
  let offset = (result[result.len() - 1] & 0x0f) as usize;
  let slice = &result[offset..offset + 4];
  let mut code = u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]);
  code &= 0x7fffffff;
  let modulo = 10u32.pow(digits);
  let value = code % modulo;
  format!("{:0width$}", value, width = digits as usize)
}
