// src/utils/response.js - 响应工具函数

export function successResponse(data = null, message = "Success") {
  return new Response(
    JSON.stringify({
      code: 0,
      message,
      data,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export function errorResponse(message = "Error", code = 400, data = null) {
  return new Response(
    JSON.stringify({
      code,
      message,
      data,
    }),
    {
      status: code,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// CSV下载响应
export function csvResponse(csvContent, filename) {
  return new Response(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename=${filename}`
    }
  });
}

// 文件下载响应 
export function downloadResponse(content, filename, contentType = 'application/octet-stream') {
  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename=${filename}`
    }
  });
}
