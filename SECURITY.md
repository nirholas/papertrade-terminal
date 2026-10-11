# Security policy

papertrade-terminal is unofficial and non-custodial. It never sees your wallet key. The only key it holds is a Papertrade session key stored in your browser's `localStorage`; it can trade but cannot withdraw. Use "Clear key" in the session card to remove it.

## Reporting a vulnerability

Please report privately through GitHub security advisories on https://github.com/nirholas/papertrade-terminal/security/advisories/new. Do not open public issues for vulnerabilities. See also `/.well-known/security.txt`.

## Scope

- Cross-site scripting, CSP bypass, or unescaped on-chain or API strings.
- Anything that causes a signature or transaction the user did not review.
- The same-origin proxy forwarding routes it should not.

Vulnerabilities in Papertrade itself belong to the Papertrade team.
