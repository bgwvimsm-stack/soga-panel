use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature as EcdsaSignature, VerifyingKey as EcdsaVerifyingKey};
use rand::RngCore;
use rsa::pkcs1v15::{Signature as RsaSignature, VerifyingKey as RsaVerifyingKey};
use rsa::RsaPublicKey;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Deserialize, Serialize)]
pub struct RegistrationCredential {
  pub id: String,
  #[serde(rename = "rawId")]
  pub raw_id: String,
  #[serde(rename = "type")]
  pub credential_type: String,
  pub response: RegistrationResponse
}

#[derive(Deserialize, Serialize)]
pub struct RegistrationResponse {
  #[serde(rename = "clientDataJSON")]
  pub client_data_json: String,
  #[serde(rename = "attestationObject")]
  pub attestation_object: String,
  pub transports: Option<Vec<String>>,
  #[serde(rename = "publicKey")]
  pub public_key: Option<String>,
  #[serde(rename = "publicKeyAlgorithm")]
  pub public_key_algorithm: Option<i64>
}

#[derive(Deserialize, Serialize)]
pub struct AuthenticationCredential {
  pub id: String,
  #[serde(rename = "rawId")]
  pub raw_id: String,
  #[serde(rename = "type")]
  pub credential_type: String,
  pub response: AuthenticationResponse
}

#[derive(Deserialize, Serialize)]
pub struct AuthenticationResponse {
  #[serde(rename = "clientDataJSON")]
  pub client_data_json: String,
  #[serde(rename = "authenticatorData")]
  pub authenticator_data: String,
  pub signature: String,
  #[serde(rename = "userHandle")]
  pub user_handle: Option<String>
}

pub struct ValidatedRegistration {
  pub credential_id: String,
  pub public_key: String,
  pub alg: i64,
  pub sign_count: u32,
  pub user_handle: Option<String>,
  pub transports: Option<Vec<String>>
}

pub struct ValidatedAuthentication {
  pub new_sign_count: u32
}

pub fn base64url_encode(input: &[u8]) -> String {
  URL_SAFE_NO_PAD.encode(input)
}

pub fn base64url_decode(input: &str) -> Result<Vec<u8>, String> {
  URL_SAFE_NO_PAD
    .decode(input.as_bytes())
    .map_err(|_| "Base64 解码失败".to_string())
}

pub fn random_challenge(bytes: usize) -> String {
  let mut buf = vec![0u8; bytes];
  rand::thread_rng().fill_bytes(&mut buf);
  base64url_encode(&buf)
}

pub fn extract_client_challenge(client_data_b64: &str) -> Option<String> {
  let decoded = base64url_decode(client_data_b64).ok()?;
  let value: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
  value.get("challenge").and_then(|v| v.as_str()).map(|v| v.to_string())
}

pub fn validate_registration_response(
  credential: &RegistrationCredential,
  expected_challenge: &str,
  expected_origin: &str,
  expected_rp_id: &str
) -> Result<ValidatedRegistration, String> {
  if credential.credential_type != "public-key" {
    return Err("无效的凭证类型".to_string());
  }

  let client_data = parse_client_data(
    &credential.response.client_data_json,
    "webauthn.create",
    expected_challenge,
    expected_origin
  )?;

  let attestation = base64url_decode(&credential.response.attestation_object)?;
  let (attestation_value, _) = decode_cbor(&attestation, 0)?;
  let auth_data = match cbor_map_get_text(&attestation_value, "authData") {
    Some(bytes) => bytes,
    None => return Err("凭证数据不完整".to_string())
  };

  let parsed_auth = parse_authenticator_data(&auth_data, expected_rp_id, true)?;
  let credential_id = parsed_auth
    .credential_id
    .ok_or_else(|| "凭证数据不完整".to_string())?;
  let credential_public_key_bytes = parsed_auth
    .credential_public_key_bytes
    .ok_or_else(|| "凭证数据不完整".to_string())?;

  let (cose_value, _) = decode_cbor(&credential_public_key_bytes, 0)?;
  let alg = match cbor_map_get_i64(&cose_value, 3) {
    Some(value) => value,
    None => credential.response.public_key_algorithm.unwrap_or(-7)
  };

  let _ = import_cose_public_key(&cose_value, alg)?;

  Ok(ValidatedRegistration {
    credential_id: base64url_encode(&credential_id),
    public_key: base64url_encode(&credential_public_key_bytes),
    alg,
    sign_count: parsed_auth.sign_count,
    user_handle: client_data.user_handle,
    transports: credential.response.transports.clone()
  })
}

pub fn validate_authentication_response(
  credential: &AuthenticationCredential,
  expected_challenge: &str,
  expected_origin: &str,
  expected_rp_id: &str,
  stored_public_key: &str,
  alg: i64,
  expected_user_handle: Option<&str>
) -> Result<ValidatedAuthentication, String> {
  if credential.credential_type != "public-key" {
    return Err("无效的凭证类型".to_string());
  }

  let client_data = parse_client_data(
    &credential.response.client_data_json,
    "webauthn.get",
    expected_challenge,
    expected_origin
  )?;

  if let Some(expected) = expected_user_handle {
    if let Some(received) = client_data
      .user_handle
      .as_ref()
      .or(credential.response.user_handle.as_ref())
    {
      if expected != received {
        return Err("userHandle 不匹配".to_string());
      }
    }
  }

  let auth_data = base64url_decode(&credential.response.authenticator_data)?;
  let parsed_auth = parse_authenticator_data(&auth_data, expected_rp_id, false)?;

  if !parsed_auth.user_present || !parsed_auth.user_verified {
    return Err("需要用户验证".to_string());
  }

  let client_data_hash = sha256(&base64url_decode(&credential.response.client_data_json)?);
  let mut data_to_verify = Vec::with_capacity(auth_data.len() + client_data_hash.len());
  data_to_verify.extend_from_slice(&auth_data);
  data_to_verify.extend_from_slice(&client_data_hash);

  let stored_key_bytes = base64url_decode(stored_public_key)?;
  let (cose_value, _) = decode_cbor(&stored_key_bytes, 0)?;
  let public_key = import_cose_public_key(&cose_value, alg)?;

  let signature = base64url_decode(&credential.response.signature)?;
  verify_signature(&public_key, alg, &data_to_verify, &signature)?;

  Ok(ValidatedAuthentication {
    new_sign_count: parsed_auth.sign_count
  })
}

fn parse_client_data(
  client_data_b64: &str,
  expected_type: &str,
  expected_challenge: &str,
  expected_origin: &str
) -> Result<ClientData, String> {
  let raw_bytes = base64url_decode(client_data_b64)?;
  let decoded: serde_json::Value =
    serde_json::from_slice(&raw_bytes).map_err(|_| "clientDataJSON 无效".to_string())?;
  let obj = decoded.as_object().ok_or_else(|| "clientDataJSON 无效".to_string())?;

  let data_type = obj
    .get("type")
    .and_then(|value| value.as_str())
    .unwrap_or("");
  if data_type != expected_type {
    return Err("clientData 类型不匹配".to_string());
  }

  let challenge = obj
    .get("challenge")
    .and_then(|value| value.as_str())
    .unwrap_or("");
  if challenge.is_empty()
    || !equal_bytes(
      &base64url_decode(challenge)?,
      &base64url_decode(expected_challenge)?
    )
  {
    return Err("challenge 校验失败".to_string());
  }

  let origin = obj
    .get("origin")
    .and_then(|value| value.as_str())
    .unwrap_or("");
  if origin.is_empty() || origin != expected_origin {
    return Err("origin 校验失败".to_string());
  }

  Ok(ClientData {
    user_handle: obj
      .get("userHandle")
      .and_then(|value| value.as_str())
      .map(|value| value.to_string())
  })
}

fn parse_authenticator_data(
  auth_data: &[u8],
  expected_rp_id: &str,
  require_credential: bool
) -> Result<ParsedAuthData, String> {
  if auth_data.len() < 37 {
    return Err("authenticatorData 无效".to_string());
  }
  let rp_id_hash = &auth_data[0..32];
  let flags = auth_data[32];
  let sign_count = u32::from_be_bytes([
    auth_data[33],
    auth_data[34],
    auth_data[35],
    auth_data[36]
  ]);

  let expected_hash = sha256(expected_rp_id.as_bytes());
  if !equal_bytes(rp_id_hash, &expected_hash) {
    return Err("rpId 校验失败".to_string());
  }

  let user_present = (flags & 0x01) != 0;
  let user_verified = (flags & 0x04) != 0;
  let attested = (flags & 0x40) != 0;

  if !user_present || !user_verified {
    return Err("需要用户验证".to_string());
  }

  let mut offset = 37;
  let mut credential_id = None;
  let mut credential_public_key_bytes = None;

  if attested {
    if auth_data.len() < offset + 16 + 2 {
      return Err("凭证数据不完整".to_string());
    }
    offset += 16;
    let cred_len = u16::from_be_bytes([auth_data[offset], auth_data[offset + 1]]) as usize;
    offset += 2;
    if auth_data.len() < offset + cred_len {
      return Err("凭证数据不完整".to_string());
    }
    let cred_end = offset + cred_len;
    credential_id = Some(auth_data[offset..cred_end].to_vec());
    offset = cred_end;

    let pk_start = offset;
    let (_, pk_end) = decode_cbor(auth_data, pk_start)?;
    if pk_end > auth_data.len() {
      return Err("凭证数据不完整".to_string());
    }
    credential_public_key_bytes = Some(auth_data[pk_start..pk_end].to_vec());
  } else if require_credential {
    return Err("缺少凭证数据".to_string());
  }

  Ok(ParsedAuthData {
    sign_count,
    credential_id,
    credential_public_key_bytes,
    user_present,
    user_verified
  })
}

fn sha256(input: impl AsRef<[u8]>) -> Vec<u8> {
  let mut hasher = Sha256::new();
  hasher.update(input.as_ref());
  hasher.finalize().to_vec()
}

fn equal_bytes(a: &[u8], b: &[u8]) -> bool {
  if a.len() != b.len() {
    return false;
  }
  a.iter().zip(b.iter()).all(|(x, y)| x == y)
}

struct ParsedAuthData {
  sign_count: u32,
  credential_id: Option<Vec<u8>>,
  credential_public_key_bytes: Option<Vec<u8>>,
  user_present: bool,
  user_verified: bool
}

struct ClientData {
  user_handle: Option<String>
}

enum PublicKeyKind {
  Ecdsa(EcdsaVerifyingKey),
  Rsa(RsaVerifyingKey<Sha256>)
}

fn import_cose_public_key(cose: &CborValue, alg: i64) -> Result<PublicKeyKind, String> {
  let kty = cbor_map_get_i64(cose, 1).ok_or_else(|| "公钥类型无效".to_string())?;
  let resolved_alg = cbor_map_get_i64(cose, 3).unwrap_or(alg);

  if kty == 2 && resolved_alg == -7 {
    let x = cbor_map_get_bytes(cose, -2).ok_or_else(|| "公钥数据不完整".to_string())?;
    let y = cbor_map_get_bytes(cose, -3).ok_or_else(|| "公钥数据不完整".to_string())?;
    if x.len() != 32 || y.len() != 32 {
      return Err("公钥数据不完整".to_string());
    }
    let mut sec1 = Vec::with_capacity(65);
    sec1.push(0x04);
    sec1.extend_from_slice(&x);
    sec1.extend_from_slice(&y);
    let key = EcdsaVerifyingKey::from_sec1_bytes(&sec1).map_err(|_| "公钥数据不完整".to_string())?;
    return Ok(PublicKeyKind::Ecdsa(key));
  }

  if kty == 3 && resolved_alg == -257 {
    let n = cbor_map_get_bytes(cose, -1).ok_or_else(|| "公钥数据不完整".to_string())?;
    let e = cbor_map_get_bytes(cose, -2).ok_or_else(|| "公钥数据不完整".to_string())?;
    let n = rsa::BigUint::from_bytes_be(&n);
    let e = rsa::BigUint::from_bytes_be(&e);
    let public_key = RsaPublicKey::new(n, e).map_err(|_| "公钥数据不完整".to_string())?;
    let verifier = RsaVerifyingKey::<Sha256>::new(public_key);
    return Ok(PublicKeyKind::Rsa(verifier));
  }

  Err("暂不支持的公钥算法".to_string())
}

fn verify_signature(
  public_key: &PublicKeyKind,
  alg: i64,
  data: &[u8],
  signature: &[u8]
) -> Result<(), String> {
  match public_key {
    PublicKeyKind::Ecdsa(key) => {
      if let Ok(sig) = EcdsaSignature::from_der(signature) {
        if key.verify(data, &sig).is_ok() {
          return Ok(());
        }
      }

      if signature.len() == 64 {
        if let Ok(sig) = EcdsaSignature::from_slice(signature) {
          if key.verify(data, &sig).is_ok() {
            return Ok(());
          }
        }
      }

      if alg == -7 {
        let raw = der_to_raw(signature, 32);
        if raw.len() == 64 {
          if let Ok(sig) = EcdsaSignature::from_slice(&raw) {
            if key.verify(data, &sig).is_ok() {
              return Ok(());
            }
          }
        }
      }

      Err("签名验证失败".to_string())
    }
    PublicKeyKind::Rsa(key) => {
      let sig = RsaSignature::try_from(signature).map_err(|_| "签名验证失败".to_string())?;
      key.verify(data, &sig).map_err(|_| "签名验证失败".to_string())
    }
  }
}

fn der_to_raw(der: &[u8], size: usize) -> Vec<u8> {
  if der.len() < 8 || der[0] != 0x30 {
    return der.to_vec();
  }
  let mut offset = 2;
  if der[1] & 0x80 != 0 {
    let len_bytes = (der[1] & 0x7f) as usize;
    offset = 2 + len_bytes;
  }
  if offset >= der.len() || der[offset] != 0x02 {
    return der.to_vec();
  }
  let r_len = der.get(offset + 1).copied().unwrap_or(0) as usize;
  let r_start = offset + 2;
  let s_marker = r_start + r_len;
  if s_marker >= der.len() || der.get(s_marker).copied().unwrap_or(0) != 0x02 {
    return der.to_vec();
  }
  let s_len = der.get(s_marker + 1).copied().unwrap_or(0) as usize;
  let s_start = s_marker + 2;
  if r_start + r_len > der.len() || s_start + s_len > der.len() {
    return der.to_vec();
  }
  let r = &der[r_start..r_start + r_len];
  let s = &der[s_start..s_start + s_len];
  let mut out = vec![0u8; size * 2];
  let r_offset = size.saturating_sub(r.len());
  out[r_offset..r_offset + r.len()].copy_from_slice(&r[r.len().saturating_sub(size)..]);
  let s_offset = size + size.saturating_sub(s.len());
  out[s_offset..s_offset + s.len()].copy_from_slice(&s[s.len().saturating_sub(size)..]);
  out
}

#[derive(Clone)]
#[allow(dead_code)]
enum CborValue {
  Unsigned(u64),
  Negative(i64),
  Bytes(Vec<u8>),
  Text(String),
  Array(Vec<CborValue>),
  Map(Vec<(CborValue, CborValue)>),
  Bool(bool),
  Null,
  Undefined
}

fn cbor_map_get_text(value: &CborValue, key: &str) -> Option<Vec<u8>> {
  let map = match value {
    CborValue::Map(map) => map,
    _ => return None
  };
  for (k, v) in map {
    if let CborValue::Text(text) = k {
      if text == key {
        if let CborValue::Bytes(bytes) = v {
          return Some(bytes.clone());
        }
      }
    }
  }
  None
}

fn cbor_map_get_i64(value: &CborValue, key: i64) -> Option<i64> {
  let map = match value {
    CborValue::Map(map) => map,
    _ => return None
  };
  for (k, v) in map {
    if let Some(kv) = cbor_to_i64(k) {
      if kv == key {
        return cbor_to_i64(v);
      }
    }
  }
  None
}

fn cbor_map_get_bytes(value: &CborValue, key: i64) -> Option<Vec<u8>> {
  let map = match value {
    CborValue::Map(map) => map,
    _ => return None
  };
  for (k, v) in map {
    if let Some(kv) = cbor_to_i64(k) {
      if kv == key {
        if let CborValue::Bytes(bytes) = v {
          return Some(bytes.clone());
        }
      }
    }
  }
  None
}

fn cbor_to_i64(value: &CborValue) -> Option<i64> {
  match value {
    CborValue::Unsigned(num) => (*num).try_into().ok(),
    CborValue::Negative(num) => Some(*num),
    _ => None
  }
}

fn decode_cbor(data: &[u8], offset: usize) -> Result<(CborValue, usize), String> {
  if offset >= data.len() {
    return Err("CBOR 数据不完整".to_string());
  }
  let initial = data[offset];
  let major = initial >> 5;
  let additional = initial & 0x1f;
  let mut cursor = offset + 1;
  let (length, next_offset) = decode_length(additional, data, cursor)?;
  cursor = next_offset;

  match major {
    0 => Ok((CborValue::Unsigned(length), cursor)),
    1 => Ok((CborValue::Negative(-(length as i64) - 1), cursor)),
    2 => {
      let end = cursor + length as usize;
      if end > data.len() {
        return Err("CBOR 数据不完整".to_string());
      }
      Ok((CborValue::Bytes(data[cursor..end].to_vec()), end))
    }
    3 => {
      let end = cursor + length as usize;
      if end > data.len() {
        return Err("CBOR 数据不完整".to_string());
      }
      let text = String::from_utf8(data[cursor..end].to_vec()).map_err(|_| "CBOR 文本无效".to_string())?;
      Ok((CborValue::Text(text), end))
    }
    4 => {
      let mut items = Vec::new();
      let mut current = cursor;
      for _ in 0..length {
        let (value, next) = decode_cbor(data, current)?;
        items.push(value);
        current = next;
      }
      Ok((CborValue::Array(items), current))
    }
    5 => {
      let mut items = Vec::new();
      let mut current = cursor;
      for _ in 0..length {
        let (key, next) = decode_cbor(data, current)?;
        let (val, next_val) = decode_cbor(data, next)?;
        items.push((key, val));
        current = next_val;
      }
      Ok((CborValue::Map(items), current))
    }
    6 => decode_cbor(data, cursor),
    7 => match additional {
      20 => Ok((CborValue::Bool(false), cursor)),
      21 => Ok((CborValue::Bool(true), cursor)),
      22 => Ok((CborValue::Null, cursor)),
      23 => Ok((CborValue::Undefined, cursor)),
      24 => {
        let value = data.get(cursor).copied().unwrap_or(0) as u64;
        Ok((CborValue::Unsigned(value), cursor + 1))
      }
      25 => {
        if cursor + 2 > data.len() {
          return Err("CBOR 数据不完整".to_string());
        }
        let value = u16::from_be_bytes([data[cursor], data[cursor + 1]]) as u64;
        Ok((CborValue::Unsigned(value), cursor + 2))
      }
      26 => {
        if cursor + 4 > data.len() {
          return Err("CBOR 数据不完整".to_string());
        }
        let value = u32::from_be_bytes([
          data[cursor],
          data[cursor + 1],
          data[cursor + 2],
          data[cursor + 3]
        ]) as u64;
        Ok((CborValue::Unsigned(value), cursor + 4))
      }
      27 => {
        if cursor + 8 > data.len() {
          return Err("CBOR 数据不完整".to_string());
        }
        let value = u64::from_be_bytes([
          data[cursor],
          data[cursor + 1],
          data[cursor + 2],
          data[cursor + 3],
          data[cursor + 4],
          data[cursor + 5],
          data[cursor + 6],
          data[cursor + 7]
        ]);
        Ok((CborValue::Unsigned(value), cursor + 8))
      }
      _ => Err("不支持的 CBOR 数据类型".to_string())
    },
    _ => Err("未知的 CBOR 主类型".to_string())
  }
}

fn decode_length(additional: u8, data: &[u8], offset: usize) -> Result<(u64, usize), String> {
  match additional {
    value if value < 24 => Ok((value as u64, offset)),
    24 => {
      if offset >= data.len() {
        return Err("CBOR 数据不完整".to_string());
      }
      Ok((data[offset] as u64, offset + 1))
    }
    25 => {
      if offset + 2 > data.len() {
        return Err("CBOR 数据不完整".to_string());
      }
      let value = u16::from_be_bytes([data[offset], data[offset + 1]]) as u64;
      Ok((value, offset + 2))
    }
    26 => {
      if offset + 4 > data.len() {
        return Err("CBOR 数据不完整".to_string());
      }
      let value = u32::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3]
      ]) as u64;
      Ok((value, offset + 4))
    }
    27 => {
      if offset + 8 > data.len() {
        return Err("CBOR 数据不完整".to_string());
      }
      let value = u64::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7]
      ]);
      Ok((value, offset + 8))
    }
    _ => Err("不支持的 CBOR 长度类型".to_string())
  }
}
