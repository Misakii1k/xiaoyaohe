# Tencent ASR proxy

Run this service behind HTTPS and configure the Android build with
`VITE_ASR_PROXY_URL=https://your-host/api/speech/tencent`.

Required server environment variables:

- `TENCENT_SECRET_ID`
- `TENCENT_SECRET_KEY`
- `TENCENT_REGION` (defaults to `ap-guangzhou`)
- `ALLOWED_ORIGINS` (comma-separated production origins)

The proxy accepts WAV audio up to 60 seconds, limits request size and request
frequency, and returns only recognized text, a sanitized error code, and the
Tencent RequestId. It does not log audio, authorization headers, or credentials.
