# Demo Script

Caller:

```text
I was charged twice for an invoice.
```

Billing agent:

```text
Would you like me to connect you with a billing specialist?
```

Caller:

```text
Yes, please connect me.
```

The app dials `HUMAN_TRANSFER_NUMBER`. When that call answers, the app bridges
the original caller to the specialist leg and starts the specialist prompt with
the billing issue as context.
