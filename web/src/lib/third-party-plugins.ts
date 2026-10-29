/**
 * Third-party plugin loading is hidden in 0.5.0.
 * `/api/plugins/third-party` and `/api/plugins/third-party/load` are not
 * implemented, so the plugins page must not offer them.
 * Set this to `true` to restore the section, the command entries, and the requests.
 */
export const THIRD_PARTY_PLUGINS_ENABLED = false

export function isThirdPartyPluginsEnabled() {
  return THIRD_PARTY_PLUGINS_ENABLED
}
