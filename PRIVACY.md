# Privacy and permissions

Openwide processes video locally on your device. It does not collect usage analytics or send video frames to a server.

## Stored data

Browser extension-local storage contains global settings, per-origin profiles, and disabled origins. Exported settings contain these preferences. Openwide does not save viewing history, media URLs, authentication tokens, or video frames.

Site origins are needed to identify profiles. Exports can therefore reveal which sites have configured profiles. Review an export before sharing it.

## Permissions

| Permission                      | Purpose                                                       |
| ------------------------------- | ------------------------------------------------------------- |
| `storage`                       | Save settings in the browser profile                          |
| `scripting`                     | Register and inject content scripts on granted origins        |
| `activeTab`                     | Work with the tab selected through the extension popup        |
| Optional HTTP/HTTPS host access | Enable video controls on sites explicitly granted by the user |

Host permission patterns cover a scheme and hostname across ports. Profiles distinguish exact origins, including ports. Embedded players need their own origin permission.

The packaged logo is exposed as a web-accessible resource for display in the player panel.

## Video processing

The page's original video element remains the playback and audio source. Readable frames are sampled in memory for padding detection, ambience, and WebGL Elastic rendering, then discarded. Pixel-based effects are unavailable when the player blocks frame access.

## Revocation

Disable a site in the popup or remove its permission through the browser. Openwide restores its owned presentation changes when disabled; permission revocation is checked within four seconds while a session is active. Uninstalling follows the browser's normal extension-data removal behavior.
