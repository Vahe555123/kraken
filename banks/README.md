# Bank Assets

Each subfolder corresponds to a bank. Place three files in each:

| File | Description | Recommended size |
|------|-------------|-----------------|
| `icon.svg` | Small bank icon shown on the page card (replaces selectedBankLogo) | 48×48 px |
| `logo.svg` | Larger logo shown in the contract header | 120×40 px |
| `stamp.svg` | Round stamp/seal shown in the contract signature area | 100×100 px |

## Bank folders

| Folder | Bank name in UI |
|--------|----------------|
| `bbva/` | BBVA |
| `sabadell/` | Banco Sabadell |
| `mastercard/` | Masters Card |
| `caixabank/` | CaixaBank |
| `ing/` | ING Bank |
| `santander/` | Santander |
| `openbank/` | Openbank |
| `visa/` | VISA |

## Notes

- You can use `.png` files instead of `.svg` — just rename the files **and** update the extension
  in `tourist/detail-transaction.html` inside the `bankAsset()` helper (one constant at the top).
- Each placeholder is a valid SVG so the contract renders without broken images until you replace them.
