# Manual acceptance checks

Load `extension/` from Chrome Developer Mode. Enable inspection, start
`npm run demo`, and open http://127.0.0.1:4173.

| Scenario | Expected result |
| --- | --- |
| Hover Save changes | Named role, one verified match, outline on button |
| Hover a nested span or SVG path | Outline on the interactive button; normalization explained |
| Move directly from Copy to another element | New selector appears without another click |
| Click Save changes while inspecting | The webpage click continues to work |
| Hover Easy Apply in each job card | Parent scope identifies the correct job; no index |
| Hover Add to cart in each product card | Product heading scopes the button |
| Hover duplicate Email address placeholders | Named Shipping/Billing form scopes the field |
| Hover invoice download controls | Correct row context |
| Hover inputs, textarea, select, checkbox, radio | Matching form control; label/role names preserved |
| Hover label text | The associated form control is identified |
| Hover icon-only controls | Accessible role and ARIA name |
| Hover Identical action siblings | Exact sibling, Fragile badge, position warning |
| Hover generated-ID button | Semantic locator; generated class and ID absent |
| Hover quoted text/ARIA label | Both languages copy valid escaped string literals |
| Click Load more controls, hover inserted button | Selector works without re-enabling inspection |
| Replace/remove a hovered node in DevTools | Revalidation updates/invalidates the recommendation |
| Hover both shadow buttons and nested shadow inputs | Open roots work; correct exact node |
| Hover each frame's controls | Complete unique frame path from `page` |
| Inspect a small nested frame | Panel remains in its viewport; copy shortcut works |
| Inspect LinkedIn Easy Apply or another modal | Panel stays above the dialog/backdrop and Copy remains clickable |
| Open another native modal while inspecting | The previous inert target is cleared; hovering the new modal selects its controls |
| Copy inside a site popover/menu | The site's popover stays open |
| Inspect a transformed/clipped modal, then resize the window | Panel remains inside the visible viewport and can still copy |
| Switch Python/JavaScript while panel is open | Code updates immediately |
| Toggle details | Accessible name and validation details appear/disappear |
| Click Copy | Clipboard contains the complete displayed expression |
| Press Escape or disable in popup | Outline and UI disappear |
| Reopen popup/restart browser | Preferences persist and badge reflects state |
| Open chrome://settings or Chrome Web Store | Popup explains browser access restriction |
| Inspect a local file with access disabled | Popup explains the file-access setting |

For live websites, use pages you can access normally. No special configuration
or site-specific selectors are required. These are manual checks, not claims
of automated live-site execution:

| Website type | Representative check |
| --- | --- |
| LinkedIn | Job cards, duplicated Easy Apply buttons, search inputs, icon-only navigation, newly loaded listings |
| E-commerce | Product grids with duplicated Add to cart actions, search, filters, quantity controls |
| Dashboard | Repeated table rows, named regions, tabs, disabled actions, dynamically refreshed panels |
| Arbitrary form | Repeated labels/placeholders, grouped fields, checkbox/radio labels, special characters |
| Web components | Open shadow roots, nested components, SVG icons within buttons |

Paste the copied JavaScript expression into an existing Playwright test:

```javascript
const locator = page.getByRole("button", { name: "Save changes", exact: true });
await expect(locator).toHaveCount(1);
await expect(locator).toBeVisible();
```

For Python, substitute the copied expression and use your project's normal
sync or async `expect`/locator API. Use the same page state and Playwright
version as the inspection when checking exact accessible-name behavior.
