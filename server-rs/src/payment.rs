use crate::config::AppEnv;
use md5::compute as md5_compute;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use urlencoding::encode;

#[derive(Clone, Debug)]
pub struct PaymentOrder {
    pub trade_no: String,
    pub amount: f64,
    pub subject: String,
    pub notify_url: String,
    pub return_url: String,
    pub clientip: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PaymentCreateResult {
    pub method: String,
    pub pay_url: Option<String>,
    pub success: bool,
    pub message: Option<String>,
    #[serde(rename = "type")]
    pub pay_type: Option<String>, // "url", "qrcode", "scheme"
}

#[derive(Clone, Debug)]
pub struct PaymentCallbackResult {
    pub ok: bool,
    pub trade_no: Option<String>,
    pub method: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PaymentMethodInfo {
    pub value: String,
    pub label: String,
    pub provider: Option<String>,
}

const CHANNELS: [&str; 3] = ["alipay", "wxpay", "crypto"];

pub fn normalize_channel(input: Option<&str>) -> Option<&'static str> {
    let value = input.unwrap_or("").trim().to_lowercase();
    if value.is_empty() {
        return None;
    }
    if value == "alipay" || value == "ali" {
        return Some("alipay");
    }
    if value == "wechat" || value == "wx" || value == "wxpay" {
        return Some("wxpay");
    }
    if value == "crypto"
        || value == "usdt"
        || value == "usdt.trc20"
        || value == "trc20"
        || value == "epusdt"
    {
        return Some("crypto");
    }
    None
}

pub fn get_channel_provider_type(env: &AppEnv, channel: &str) -> Option<&'static str> {
    let raw = match channel {
        "alipay" => env.payment_alipay.as_deref(),
        "wxpay" => env.payment_wxpay.as_deref(),
        "crypto" => env.payment_crypto.as_deref(),
        _ => None,
    }?;
    let normalized = raw.trim().to_lowercase();
    if normalized.is_empty() || normalized == "none" {
        return None;
    }
    if normalized == "epay" {
        return Some("epay");
    }
    if normalized == "epusdt" {
        return Some("epusdt");
    }
    None
}

pub fn get_payment_methods(env: &AppEnv) -> Vec<PaymentMethodInfo> {
    active_channels(env)
        .into_iter()
        .map(|ch| {
            let provider = get_channel_provider_type(env, ch).map(|value| value.to_string());
            let (value, label) = match ch {
                "crypto" => ("usdt".to_string(), "USDT".to_string()),
                "wxpay" => ("wechat".to_string(), "微信支付".to_string()),
                _ => ("alipay".to_string(), "支付宝".to_string()),
            };
            PaymentMethodInfo {
                value,
                label,
                provider,
            }
        })
        .collect()
}

pub fn verify_callback(
    env: &AppEnv,
    payload: &serde_json::Map<String, Value>,
) -> PaymentCallbackResult {
    if payload.contains_key("token")
        || payload.get("payType").and_then(Value::as_str) == Some("epusdt")
    {
        let mut result = verify_epusdt_callback(env, payload);
        result.method = Some("epusdt".to_string());
        return result;
    }

    let mut epay = verify_epay_callback(env, payload);
    if epay.ok {
        epay.method = Some("epay".to_string());
        return epay;
    }

    let mut epusdt = verify_epusdt_callback(env, payload);
    if epusdt.ok {
        epusdt.method = Some("epusdt".to_string());
        return epusdt;
    }

    PaymentCallbackResult {
        ok: false,
        trade_no: None,
        method: None,
    }
}

pub fn verify_epay_callback(
    env: &AppEnv,
    payload: &serde_json::Map<String, Value>,
) -> PaymentCallbackResult {
    if !is_epay_configured(env) {
        return PaymentCallbackResult {
            ok: false,
            trade_no: None,
            method: None,
        };
    }

    let sign = payload
        .get("sign")
        .map(value_to_string)
        .unwrap_or_default()
        .to_lowercase();
    if sign.is_empty() {
        return PaymentCallbackResult {
            ok: false,
            trade_no: get_trade_no(payload),
            method: None,
        };
    }

    let sign_key = env.epay_key.clone().unwrap_or_default();
    let mut params = std::collections::BTreeMap::<String, String>::new();
    for (key, value) in payload.iter() {
        if key == "sign" || key == "sign_type" {
            continue;
        }
        let val = value_to_string(value);
        if val.is_empty() {
            continue;
        }
        params.insert(key.clone(), val);
    }
    let base = params
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    let expected = md5_hex(&(base + &sign_key)).to_lowercase();

    PaymentCallbackResult {
        ok: expected == sign,
        trade_no: get_trade_no(payload),
        method: None,
    }
}

pub fn verify_epusdt_callback(
    env: &AppEnv,
    payload: &serde_json::Map<String, Value>,
) -> PaymentCallbackResult {
    if !is_epusdt_configured(env) {
        return PaymentCallbackResult {
            ok: false,
            trade_no: None,
            method: None,
        };
    }

    let signature = payload
        .get("signature")
        .or_else(|| payload.get("sign"))
        .map(value_to_string)
        .unwrap_or_default()
        .to_lowercase();
    if signature.is_empty() {
        return PaymentCallbackResult {
            ok: false,
            trade_no: get_trade_no(payload),
            method: None,
        };
    }

    let mut params = std::collections::BTreeMap::<String, String>::new();
    for (key, value) in payload.iter() {
        if key == "signature" || key == "sign" {
            continue;
        }
        let value_str = value_to_string(value);
        if value_str.trim().is_empty() {
            continue;
        }
        params.insert(key.clone(), value_str);
    }
    let base = params
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    let token = env.epusdt_token.clone().unwrap_or_default();
    let expected = md5_hex(&(base + &token)).to_lowercase();

    let status_ok = payload
        .get("status")
        .and_then(value_to_f64)
        .map(|value| (value - 2.0).abs() < f64::EPSILON)
        .unwrap_or(true);

    PaymentCallbackResult {
        ok: expected == signature && status_ok,
        trade_no: get_trade_no(payload),
        method: None,
    }
}

pub fn active_channels(env: &AppEnv) -> Vec<&'static str> {
    CHANNELS
        .iter()
        .copied()
        .filter(|ch| {
            let provider = match get_channel_provider_type(env, ch) {
                Some(value) => value,
                None => return false,
            };
            match provider {
                "epay" => is_epay_configured(env),
                "epusdt" => is_epusdt_configured(env),
                _ => false,
            }
        })
        .collect()
}

pub async fn create_payment(
    env: &AppEnv,
    order: &PaymentOrder,
    prefer: Option<&str>,
) -> Result<PaymentCreateResult, String> {
    let channel = normalize_channel(prefer)
        .or_else(|| active_channels(env).first().copied())
        .ok_or_else(|| "支付方式不可用".to_string())?;
    let provider =
        get_channel_provider_type(env, channel).ok_or_else(|| "支付方式未配置".to_string())?;

    match provider {
        "epay" => create_epay_payment(env, order, channel).await,
        "epusdt" => create_epusdt_payment(env, order).await,
        _ => Err("支付方式未配置".to_string()),
    }
}

fn is_epay_configured(env: &AppEnv) -> bool {
    env.epay_api_url
        .as_ref()
        .is_some_and(|v| !v.trim().is_empty())
        && env.epay_pid.as_ref().is_some_and(|v| !v.trim().is_empty())
        && env.epay_key.as_ref().is_some_and(|v| !v.trim().is_empty())
}

fn is_epusdt_configured(env: &AppEnv) -> bool {
    env.epusdt_api_url
        .as_ref()
        .is_some_and(|v| !v.trim().is_empty())
        && env
            .epusdt_token
            .as_ref()
            .is_some_and(|v| !v.trim().is_empty())
        && env
            .epusdt_notify_url
            .as_ref()
            .is_some_and(|v| !v.trim().is_empty())
}

async fn create_epay_payment(env: &AppEnv, order: &PaymentOrder, channel: &str) -> Result<PaymentCreateResult, String> {
    if !is_epay_configured(env) {
        return Ok(PaymentCreateResult {
            method: "epay".to_string(),
            pay_url: None,
            success: false,
            message: Some("支付方式未配置".to_string()),
            pay_type: None,
        });
    }

    let api_url = env
        .epay_api_url
        .as_ref()
        .map(|value| value.trim().trim_end_matches('/'))
        .unwrap_or("https://pay.example.com");
    
    let payment_mode = env.epay_payment_mode.as_deref().unwrap_or("redirect").to_lowercase();
    
    let pay_type = if channel == "wxpay" {
        "wxpay"
    } else {
        "alipay"
    };
    let return_url = if !order.return_url.trim().is_empty() {
        order.return_url.trim().to_string()
    } else {
        env.epay_return_url.clone().unwrap_or_default()
    };
    let notify_url = if !order.notify_url.trim().is_empty() {
        order.notify_url.trim().to_string()
    } else {
        env.epay_notify_url.clone().unwrap_or_default()
    };

    let mut params = std::collections::BTreeMap::<String, String>::new();
    params.insert("pid".to_string(), env.epay_pid.clone().unwrap_or_default());
    params.insert("type".to_string(), pay_type.to_string());
    params.insert("out_trade_no".to_string(), order.trade_no.clone());
    params.insert("notify_url".to_string(), notify_url);
    params.insert("return_url".to_string(), return_url);
    params.insert("name".to_string(), order.subject.clone());
    params.insert("money".to_string(), order.amount.to_string());
    params.insert("clientip".to_string(), order.clientip.clone().unwrap_or_else(|| "127.0.0.1".to_string()));
    params.insert(
        "sitename".to_string(),
        env.site_name
            .clone()
            .unwrap_or_else(|| "Soga Panel".to_string()),
    );

    let sign_base = params
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    let sign_key = env.epay_key.clone().unwrap_or_default();
    let sign = md5_hex(&(sign_base + &sign_key));
    params.insert("sign".to_string(), sign);
    params.insert("sign_type".to_string(), "MD5".to_string());

    if payment_mode == "api" {
        let mapi_url = format!("{api_url}/mapi.php");
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|err| {
                eprintln!("Failed to build reqwest client: {}", err);
                err.to_string()
            })?;

        let response = client
            .post(mapi_url)
            .form(&params)
            .send()
            .await
            .map_err(|err| {
                eprintln!("易支付接口请求失败: {}", err);
                format!("易支付接口请求失败: {err}")
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            eprintln!("易支付接口错误: {} - {}", status, text);
            return Ok(PaymentCreateResult {
                method: "epay".to_string(),
                pay_url: None,
                success: false,
                message: Some(format!("易支付接口错误: {}", status)),
                pay_type: None,
            });
        }

        #[derive(Deserialize)]
        struct EpayApiResponse {
            code: i64,
            msg: Option<String>,
            payurl: Option<String>,
            qrcode: Option<String>,
            urlscheme: Option<String>,
        }

        let text = response.text().await.map_err(|err| {
            eprintln!("Failed to get response text: {}", err);
            err.to_string()
        })?;
        
        let data: EpayApiResponse = match serde_json::from_str(&text) {
            Ok(d) => d,
            Err(err) => {
                eprintln!("易支付响应解析失败: {} - Response: {}", err, text);
                return Ok(PaymentCreateResult {
                    method: "epay".to_string(),
                    pay_url: None,
                    success: false,
                    message: Some("支付接口响应格式错误".to_string()),
                    pay_type: None,
                });
            }
        };

        if data.code == 1 {
            let (pay_url, p_type) = if let Some(url) = data.payurl {
                (Some(url), Some("url".to_string()))
            } else if let Some(qr) = data.qrcode {
                (Some(qr), Some("qrcode".to_string()))
            } else if let Some(scheme) = data.urlscheme {
                (Some(scheme), Some("scheme".to_string()))
            } else {
                (None, None)
            };

            Ok(PaymentCreateResult {
                method: "epay".to_string(),
                pay_url,
                success: true,
                message: None,
                pay_type: p_type,
            })
        } else {
            Ok(PaymentCreateResult {
                method: "epay".to_string(),
                pay_url: None,
                success: false,
                message: data.msg.or(Some("易支付下单失败".to_string())),
                pay_type: None,
            })
        }
    } else {
        let query = params
            .iter()
            .map(|(k, v)| format!("{k}={}", encode(v)))
            .collect::<Vec<_>>()
            .join("&");
        let pay_url = format!("{api_url}/submit.php?{query}");

        Ok(PaymentCreateResult {
            method: "epay".to_string(),
            pay_url: Some(pay_url),
            success: true,
            message: None,
            pay_type: Some("url".to_string()),
        })
    }
}

async fn create_epusdt_payment(
    env: &AppEnv,
    order: &PaymentOrder,
) -> Result<PaymentCreateResult, String> {
    if !is_epusdt_configured(env) {
        return Ok(PaymentCreateResult {
            method: "epusdt".to_string(),
            pay_url: None,
            success: false,
            message: Some("USDT 支付未配置".to_string()),
            pay_type: None,
        });
    }

    if order.trade_no.trim().is_empty() {
        return Ok(PaymentCreateResult {
            method: "epusdt".to_string(),
            pay_url: None,
            success: false,
            message: Some("缺少订单编号".to_string()),
            pay_type: None,
        });
    }
    if !order.amount.is_finite() || order.amount <= 0.0 {
        return Ok(PaymentCreateResult {
            method: "epusdt".to_string(),
            pay_url: None,
            success: false,
            message: Some("金额异常".to_string()),
            pay_type: None,
        });
    }

    let notify_url = if !order.notify_url.trim().is_empty() {
        order.notify_url.trim().to_string()
    } else {
        env.epusdt_notify_url.clone().unwrap_or_default()
    };
    let return_url = if !order.return_url.trim().is_empty() {
        order.return_url.trim().to_string()
    } else {
        env.epusdt_return_url.clone().unwrap_or_default()
    };
    let trade_type = env
        .epusdt_trade_type
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "usdt.trc20".to_string());
    let timeout = env.epusdt_timeout.unwrap_or(600).max(60);

    let mut payload_map = std::collections::BTreeMap::<String, String>::new();
    payload_map.insert("order_id".to_string(), order.trade_no.clone());
    payload_map.insert("amount".to_string(), order.amount.to_string());
    payload_map.insert("trade_type".to_string(), trade_type);
    payload_map.insert("notify_url".to_string(), notify_url);
    payload_map.insert("redirect_url".to_string(), return_url);
    payload_map.insert("timeout".to_string(), timeout.to_string());

    let signature =
        generate_epusdt_sign(&payload_map, env.epusdt_token.clone().unwrap_or_default());
    payload_map.insert("signature".to_string(), signature);

    let api_base = env.epusdt_api_url.clone().unwrap_or_default();
    let url = format!(
        "{}/api/v1/order/create-transaction",
        api_base.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|err| err.to_string())?;

    let payload_json: Value = payload_map
        .iter()
        .map(|(k, v)| (k.clone(), Value::String(v.clone())))
        .collect::<serde_json::Map<String, Value>>()
        .into();

    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&payload_json)
        .send()
        .await
        .map_err(|err| format!("USDT 支付请求失败: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Ok(PaymentCreateResult {
            method: "epusdt".to_string(),
            pay_url: None,
            success: false,
            message: Some(format!("USDT 支付接口错误: {} {}", status.as_u16(), text)),
            pay_type: None,
        });
    }

    let data: EpusdtCreateResponse = response
        .json()
        .await
        .map_err(|_| "USDT 支付解析响应失败".to_string())?;

    if data.status_code != 200 {
        return Ok(PaymentCreateResult {
            method: "epusdt".to_string(),
            pay_url: None,
            success: false,
            message: Some(
                data.message
                    .unwrap_or_else(|| "创建 USDT 支付订单失败".to_string()),
            ),
            pay_type: None,
        });
    }

    let pay_url = data
        .data
        .and_then(|value| value.payment_url)
        .filter(|value| !value.trim().is_empty());
    if pay_url.is_none() {
        return Ok(PaymentCreateResult {
            method: "epusdt".to_string(),
            pay_url: None,
            success: false,
            message: Some(
                data.message
                    .unwrap_or_else(|| "创建 USDT 支付订单失败".to_string()),
            ),
            pay_type: None,
        });
    }

    Ok(PaymentCreateResult {
        method: "epusdt".to_string(),
        pay_url,
        success: true,
        message: None,
        pay_type: Some("url".to_string()),
    })
}

fn generate_epusdt_sign(
    params: &std::collections::BTreeMap<String, String>,
    token: String,
) -> String {
    let base = params
        .iter()
        .filter(|(k, v)| !k.is_empty() && !v.trim().is_empty() && *k != "signature" && *k != "sign")
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    md5_hex(&(base + &token))
}

pub fn md5_hex(input: &str) -> String {
    format!("{:x}", md5_compute(input.as_bytes()))
}

fn get_trade_no(payload: &serde_json::Map<String, Value>) -> Option<String> {
    payload
        .get("out_trade_no")
        .or_else(|| payload.get("trade_no"))
        .or_else(|| payload.get("order_id"))
        .map(value_to_string)
        .filter(|value| !value.trim().is_empty())
}

pub fn value_to_string(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    if let Some(number) = value.as_i64() {
        return number.to_string();
    }
    if let Some(number) = value.as_f64() {
        return number.to_string();
    }
    if let Some(flag) = value.as_bool() {
        return if flag {
            "true".to_string()
        } else {
            "false".to_string()
        };
    }
    String::new()
}

pub fn value_to_f64(value: &Value) -> Option<f64> {
    if let Some(number) = value.as_f64() {
        return Some(number);
    }
    if let Some(number) = value.as_i64() {
        return Some(number as f64);
    }
    if let Some(text) = value.as_str() {
        return text.parse::<f64>().ok();
    }
    None
}

#[derive(Deserialize)]
struct EpusdtCreateResponse {
    status_code: i64,
    message: Option<String>,
    data: Option<EpusdtCreateData>,
}

#[derive(Deserialize)]
struct EpusdtCreateData {
    payment_url: Option<String>,
}
