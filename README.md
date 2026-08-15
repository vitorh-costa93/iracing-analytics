# iRacing OAuth Test

Protótipo para testar o fluxo oficial Authorization Code + PKCE da iRacing.

## Importante
A iRacing exige um `client_id` emitido durante o registro de cliente. A criação de novos OAuth Client IDs está atualmente pausada. Portanto, este projeto **não inventa nem reutiliza o client_id interno da interface da iRacing**: ele precisa ser colocado no `.env.local` quando/ se a iRacing fornecer um para nossa aplicação.

## Configuração

```bash
npm install
cp .env.example .env.local
npm run dev
```

Abra `http://127.0.0.1:3000`.

A redirect URI precisa estar registrada exatamente como:
`http://127.0.0.1:3000/api/auth/iracing/callback`

## O que o teste valida
- `/authorize`
- login/autorização da iRacing
- state
- PKCE S256
- callback
- `/token`
- `/iracing/profile`

O perfil é o primeiro teste porque a documentação diz que `iracing.profile` retorna nome e customer ID. Depois, com `iracing.auth`, podemos testar a Data API.
