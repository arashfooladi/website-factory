# Theme settings

Appearance → Maintheme stores presentation data in the single `maintheme_options` option.

| Key | Use |
|---|---|
| `announcement_enabled` | Shows or hides the announcement block. |
| `announcement_text` | Main announcement message. |
| `announcement_link_label` | Announcement call-to-action label. |
| `announcement_link_url` | Absolute or root-relative call-to-action URL. |
| `support_phone` | Click-to-call footer number. |
| `support_email` | Footer support email. |
| `support_hours` | Support schedule. |
| `store_address` | Physical or business address. |
| `instagram_url` | Instagram profile. |
| `telegram_url` | Telegram profile/channel. |
| `whatsapp_url` | WhatsApp contact URL. |
| `footer_note` | Brand summary in the footer. |
| `copyright_text` | Copyright text; year is inserted automatically. |
| `product_delivery_note` | Delivery reassurance on product pages. |
| `product_return_note` | Return-policy reassurance on product pages. |
| `return_policy_url` | Destination of the return-policy reassurance link. |

Child themes can add settings through `maintheme_settings_schema`. New fields must include a safe sanitization callback.
