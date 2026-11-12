# Tunnel options for the MbaLong web app

Research date: 2026-11-12. Sources below are limited to official vendor documentation and the official 9Router repository.

## What “a tunnel like 9Router” means

9Router is an AI gateway/router, not a standalone tunnel network. Its official site describes its remote-access feature as a “Cloudflare edge tunnel”, and a log from the official repository shows it launching a Cloudflare **Quick Tunnel** at `*.trycloudflare.com`. In other words, the useful behavior to copy is “give a localhost service a public HTTPS URL”, not “install 9Router inside MbaLong”. See [9Router’s official feature page](https://docs.9router.com/) and the [official 9Router Quick Tunnel issue/log](https://github.com/decolua/9router/issues/1545).

Installing 9Router only to expose this web app would add an unrelated AI proxy and more software to maintain. MbaLong should run a tunnel agent directly.

## Recommendation

1. **Best production choice when the owner has a domain: a named Cloudflare Tunnel.** It has a stable custom hostname, runs as a system service, needs no inbound port, and is designed for production. Cloudflare documents that the connector initiates the connection from inside the network, so the origin does not need a public address or open inbound port ([Tunnel fundamentals](https://developers.cloudflare.com/tunnel/concepts/)).
2. **Best no-domain choice for this user: Tailscale Funnel.** The user already uses Tailscale. Funnel supplies a stable `https://<machine>.<tailnet>.ts.net` URL, requires no DNS record or purchased domain, can persist across reboot with `--bg`, and Tailscale explicitly states that public DNS resolves to its relay rather than the device IP ([Funnel architecture](https://tailscale.com/docs/features/tailscale-funnel), [CLI persistence](https://tailscale.com/docs/reference/tailscale-cli/funnel)). It is still marked beta and has non-configurable bandwidth limits.
3. **ngrok is a reasonable no-domain fallback.** A free account has one static auto-assigned dev domain, but the free plan has traffic limits and a browser interstitial. It requires an account and authtoken ([domains](https://ngrok.com/docs/gateway/domains), [pricing/limits](https://ngrok.com/docs/pricing-limits)).
4. **Cloudflare Quick Tunnel is only for a temporary test.** It needs no account or domain, but its hostname changes every time, has no uptime guarantee, caps in-flight requests at 200, and does not support SSE ([Quick Tunnel limits](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)). A changing hostname would invalidate previously sent MbaLong chicken-management links unless `PUBLIC_ORIGIN` were rewritten and the bot restarted every time.

## Option comparison

| Option | Stable public URL | Account/domain | Noninteractive Ubuntu deployment | Origin IP hidden from web visitors | Main limitation |
| --- | --- | --- | --- | --- | --- |
| Named Cloudflare Tunnel | Yes, custom hostname | Cloudflare account plus a domain in Cloudflare; tunnel/API token | Yes, after credentials are supplied; dashboard can be replaced by Cloudflare APIs | Yes; connector is outbound-only | Domain and one-time Cloudflare configuration required |
| Tailscale Funnel | Yes, machine name under `*.ts.net` | Tailscale account/tailnet; no purchased domain | Yes after the tailnet permits Funnel; auth key and `--yes --bg` remove host-side prompts | Yes; Tailscale says the relay URL never exposes the device IP | Beta, fixed `*.ts.net` name, bandwidth limits |
| ngrok | Yes, assigned free dev domain | ngrok account and authtoken; no purchased domain | Yes, agent config plus native service | Yes for the endpoint path; agent uses an outbound TLS connection | Free-plan quota and interstitial; custom domain is paid |
| Cloudflare Quick Tunnel | No | None | Process can start unattended, but URL must be parsed on each start | Yes | Development only; hostname changes and no uptime guarantee |

## Deployment contract: named Cloudflare Tunnel

### Required input

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ZONE_ID`
- `CLOUDFLARE_API_TOKEN` with Cloudflare Tunnel Edit and DNS Edit permissions
- A hostname such as `ga.example.com`
- The local service URL `http://127.0.0.1:8787`

Cloudflare documents a fully API-driven flow: create the tunnel, upload ingress rules mapping the hostname to the local service, create a proxied CNAME to `<TUNNEL_ID>.cfargotunnel.com`, obtain the tunnel token, and install `cloudflared` as a service ([API setup](https://developers.cloudflare.com/tunnel/get-started/)). The resulting ingress should be equivalent to:

```json
{
  "ingress": [
    {
      "hostname": "ga.example.com",
      "service": "http://127.0.0.1:8787"
    },
    {
      "service": "http_status:404"
    }
  ]
}
```

After the remote tunnel and route exist, the official Linux service command is:

```bash
sudo cloudflared service install "$CLOUDFLARE_TUNNEL_TOKEN"
```

For newer `cloudflared`, a token file is safer than exposing the secret in a process argument; Cloudflare supports `tunnel run --token-file <PATH>` as of version 2025.4.0 ([run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/)). A remotely managed tunnel token is equivalent to permission to run that tunnel, so it must be treated as a secret and rotated if leaked ([tunnel token security](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/)).

The app should remain bound to `127.0.0.1:8787`, and `PUBLIC_ORIGIN` should be exactly `https://ga.example.com`. Port 8787 should not be opened in UFW or the VPS provider firewall. Do not create an A/AAAA record for this hostname pointing at the VPS. Cloudflare warns that DNS-only records on the same server can reveal the origin IP even when the web record is proxied ([exposed IP records](https://developers.cloudflare.com/dns/manage-dns-records/troubleshooting/exposed-ip-address/)).

### What cannot be automated without user-owned credentials

Automation cannot create a stable Cloudflare hostname from nothing. The user must own/control a domain in Cloudflare and provide either a pre-created tunnel token or an API token with the necessary account and zone permissions. Once those inputs exist, setup can be noninteractive.

## Deployment contract: Tailscale Funnel

This is the most convenient immediate route if the VPS is already logged into the user’s tailnet.

Tailscale Funnel requires Tailscale 1.38.3 or newer, MagicDNS, HTTPS certificates, and a `funnel` node attribute in the tailnet policy. It is available on all plans, only exposes TLS on public ports 443, 8443, or 10000, and proxies to a localhost service ([requirements and limits](https://tailscale.com/docs/features/tailscale-funnel)). The MbaLong service itself can stay on local port 8787.

On an already authenticated VPS:

```bash
sudo tailscale funnel --bg --yes http://127.0.0.1:8787
sudo tailscale funnel status
```

`--bg` makes the configuration survive Tailscale/service restarts and reboot; `--yes` suppresses CLI confirmation. The documented proxy target is `http://127.0.0.1`, which avoids IPv4/IPv6 ambiguity ([Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel)). Set `PUBLIC_ORIGIN` to the HTTPS URL shown by `tailscale funnel status`, for example:

```dotenv
HOST=127.0.0.1
PORT=8787
PUBLIC_ORIGIN=https://mbalong.example-tailnet.ts.net
```

For a fresh VPS, host enrollment can also be noninteractive with a Tailscale auth key:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key="file:/run/secrets/mbalong-ts-auth-key" --hostname=mbalong
sudo tailscale funnel --bg --yes http://127.0.0.1:8787
```

Tailscale officially supports `--auth-key` and `--hostname` for unattended server provisioning ([server provisioning](https://tailscale.com/docs/how-to/set-up-servers)). Prefer a one-off/pre-authorized key or a secret file; passing a reusable key directly can leave it in shell history ([auth-key handling](https://tailscale.com/docs/features/access-control/auth-keys/how-to/secure-auth-keys)). If the tailnet policy does not already permit Funnel, an Owner/Admin/Network admin must enable it once. The public certificate name is recorded publicly, so use a non-sensitive machine name ([Tailscale HTTPS certificate privacy](https://tailscale.com/docs/how-to/set-up-https-certificates)).

Funnel is different from Tailscale Serve: Serve is private to tailnet members, while Funnel is reachable by any group member in a normal browser without installing Tailscale.

## Deployment contract: ngrok

ngrok needs a free account and an authtoken. Every account receives one static dev domain, and starting an endpoint without a custom URL reuses that assigned name ([ngrok dev domains](https://ngrok.com/docs/gateway/domains)). A version 3 agent configuration can be:

```yaml
version: 3
agent:
  authtoken: REPLACE_WITH_SECRET
endpoints:
  - name: mbal-long
    url: https://
    upstream:
      url: http://127.0.0.1:8787
```

The `url: https://` form selects the account’s assigned dev domain; ngrok documents the same configuration pattern in its [HTTP endpoint guide](https://ngrok.com/docs/gateway/endpoints/http). It can be installed and supervised as a native service:

```bash
sudo ngrok service install --config /etc/ngrok.yml
sudo ngrok service start
```

These are the vendor’s documented Linux service commands ([Linux install page](https://ngrok.com/download/linux)). The config must be readable only by root because it contains the authtoken. On the free plan, expect the assigned `ngrok-free.*` hostname, an interstitial browser page, and plan quotas; a chosen ngrok-branded hostname or a custom domain requires a paid plan.

## Security and verification checklist

The tunnel hides the web origin only if direct access is also closed. It does not magically conceal an IP already disclosed by SSH, mail, old DNS history, another DNS-only record, or a separate service on the same VPS.

After deployment:

```bash
# The app must listen only on loopback, not 0.0.0.0 or [::].
sudo ss -lptn 'sport = :8787'

# Verify local health before blaming the tunnel.
curl -fsS http://127.0.0.1:8787/api/health

# Verify the public HTTPS path from another network.
curl -fsS https://PUBLIC_HOSTNAME/api/health
```

Also verify:

- UFW/cloud firewall has no public rule for TCP 8787.
- `PUBLIC_ORIGIN` contains the final stable HTTPS origin with no trailing path.
- Tunnel/auth/API tokens are not committed to Git or printed in setup logs.
- Admin and per-user chicken pages still enforce their own authentication. A tunnel provides transport and reachability; it does not replace application authorization.
- The public hostname is checked after reboot before links are sent in Zalo.

## Implementation decision for MbaLong

The setup script should offer these explicit modes rather than silently selecting an unstable URL:

- `tailscale`: recommended default when Tailscale is already installed; enable Funnel, read its stable URL, and set `PUBLIC_ORIGIN`.
- `cloudflare`: production/custom-domain mode; require `CLOUDFLARE_TUNNEL_TOKEN` plus the preconfigured public hostname (or the broader API inputs above).
- `ngrok`: no-domain fallback; require `NGROK_AUTHTOKEN`, then read the assigned dev domain and set `PUBLIC_ORIGIN`.
- `none`: local-only mode for SSH forwarding or reverse proxy setups.

Do not make Quick Tunnel the default. If offered at all, label it “temporary test” and make clear that links stop working whenever the tunnel process restarts.
