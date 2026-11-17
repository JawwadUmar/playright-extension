# Third-party notices

Locator Lens bundles the DOM selector evaluator and accessibility utilities from
Microsoft Playwright 1.65.1 (https://github.com/microsoft/playwright), copyright
Microsoft Corporation and contributors, under Apache License 2.0.

The build creates a read-only subclass that disables Playwright's event
interceptors, global-listener recovery, and custom-engine evaluation. The
selector matching and accessibility algorithms remain Playwright's own.
The original license and upstream notices are distributed as
extension/PLAYWRIGHT-LICENSE, extension/PLAYWRIGHT-NOTICE, and
extension/PLAYWRIGHT-ThirdPartyNotices.txt.

Playwright and esbuild are development dependencies. Neither a browser driver
nor Node.js is needed to use the built extension.
