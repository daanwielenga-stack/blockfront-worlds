# Monetization setup

## Current state

Advertising code is **OFF by default**. The game is fully playable without any ad provider.

`static/ads.js` is an adapter rather than hard-coded business logic. This makes it possible to add/change providers later while keeping gameplay code separate.

Prepared placements:

1. **Menu display placement** — outside the active game canvas and away from the central Play button.
2. **Natural round-break placement** — only shown after a round completes.
3. **No ad placement during continuous FPS play.**

## Environment variables

Set these in your host, not in source code:

```text
ADS_ENABLED=1
ADS_PROVIDER=adsense
ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXX
ADSENSE_MENU_SLOT=XXXXXXXXXX
ADSENSE_BREAK_SLOT=XXXXXXXXXX
```

Do not enable `ADS_ENABLED=1` until the site/provider account is actually ready.

## Google-specific launch checklist

Before enabling Google advertising:

- obtain AdSense/H5 Games approval as applicable;
- use the exact publisher/slot values issued to your account;
- update the Privacy page with your actual data/cookie practices;
- implement the appropriate Google-certified consent-management platform for applicable EEA/UK/Swiss personalized-ad traffic;
- verify placements do not invite accidental clicks or sit next to heavy game interaction;
- do not trigger interstitial/full-screen ads during continuous gameplay;
- if Google asks for `ads.txt`, publish the exact account-specific line they provide;
- review the final site against current Google Publisher Policies before launch.

## Better revenue architecture later

For meaningful traffic, consider multiple revenue sources rather than maximizing ad density:

- menu/between-round ads;
- optional supporter tier that removes ads;
- original cosmetic skins;
- branded tournaments/sponsored worlds;
- creator codes or community servers if the audience grows.

The strongest rule for this game is: **monetization should never damage aim, movement or trust.**
