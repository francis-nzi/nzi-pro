export type UploadProgressHandler = (progress: {
  percent: number;
  loaded: number;
  total: number;
}) => void;

export type UploadResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  text: () => Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: <T = any>() => Promise<T>;
  rawText: string;
};

type UploadRequestInit = {
  method?: string;
  headers?: HeadersInit;
  body?: FormData;
  credentials?: RequestCredentials;
  onProgress?: UploadProgressHandler;
};

function parseHeaders(raw: string): Headers {
  const headers = new Headers();
  raw
    .trim()
    .split(/[\r\n]+/)
    .forEach((line) => {
      if (!line) return;
      const index = line.indexOf(":");
      if (index <= 0) return;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key) headers.append(key, value);
    });
  return headers;
}

export function uploadFormDataWithProgress(
  url: string,
  init: UploadRequestInit = {},
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method || "POST", url, true);
    xhr.withCredentials = init.credentials === "include" || init.credentials === "same-origin";

    const headers = init.headers;
    if (headers) {
      if (headers instanceof Headers) {
        headers.forEach((value, key) => xhr.setRequestHeader(key, value));
      } else if (Array.isArray(headers)) {
        headers.forEach(([key, value]) => xhr.setRequestHeader(key, value));
      } else {
        Object.entries(headers).forEach(([key, value]) => {
          if (typeof value === "string") xhr.setRequestHeader(key, value);
        });
      }
    }

    xhr.upload.onprogress = (event) => {
      if (!init.onProgress) return;
      const total = event.lengthComputable ? event.total : 0;
      const loaded = event.loaded;
      const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      init.onProgress({ percent, loaded, total });
    };

    xhr.onerror = () => reject(new Error("Upload failed due to a network error"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));

    xhr.onload = () => {
      const rawText = xhr.responseText ?? "";
      const responseHeaders = parseHeaders(xhr.getAllResponseHeaders() || "");
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
        headers: responseHeaders,
        rawText,
        text: async () => rawText,
        json: async <T = unknown>() => JSON.parse(rawText || "{}") as T,
      });
    };

    if (init.body) {
      xhr.send(init.body);
      return;
    }
    xhr.send();
  });
}
