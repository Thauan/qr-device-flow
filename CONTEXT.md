# qr-device-flow — Contexto de desenvolvimento

Este documento serve como briefing para retomar o desenvolvimento da biblioteca `qr-device-flow`. Se você é um agente de IA ou desenvolvedor humano pegando o projeto do zero, leia este arquivo inteiro antes de escrever qualquer código.

---

## 1. O problema que a lib resolve

Login via QR code no estilo WhatsApp Web / Banco Inter: o usuário tem um app mobile já autenticado, escaneia um QR exibido na página web, aprova no celular, e a web é automaticamente logada — sem digitar senha no navegador.

## 2. Posicionamento e diferenciação

O ecossistema de libs de QR login em JavaScript tem dois extremos:

- **Libs baixo nível** (`qrcode`, `qr-scanner`) — resolvem só desenhar/ler o QR. Maduras, mas não cobrem o fluxo de auth.
- **SaaS comerciais** (Authsignal, OwnID, WorkOS) — cobrem o fluxo completo, pagos, com vendor lock-in.

No meio existe um vazio: não há lib open-source popular e mantida que faça o fluxo completo sem lock-in. Tentativas passadas (ex: `qr-auth` no npm) morreram por quererem ser framework demais ou por inventar protocolo próprio.

**Nosso posicionamento:** implementação open-source do **OAuth 2.0 Device Authorization Grant (RFC 8628)** adaptado para QR, framework-agnostic, security-sane-by-default. A mesma especificação que smart TVs e CLIs (`gh auth login`) usam — só que com UX de QR em vez de código digitado. Isso nos dá reutilização de um padrão conhecido em vez de protocolo inventado.

Referência do RFC: https://www.rfc-editor.org/rfc/rfc8628

## 3. Arquitetura dos pacotes

A lib é um monorepo com os seguintes pacotes planejados:

```
@qr-device-flow/core           ✅ PRONTO   - tipos, constantes, máquina de estados, geração de códigos
@qr-device-flow/server         ✅ PRONTO   - motor HTTP-agnostic, interface de storage, MemoryStorage
@qr-device-flow/web            ⏳ A FAZER  - cliente browser: renderiza QR, conecta WebSocket/SSE
@qr-device-flow/react-native   ⏳ A FAZER  - componente scanner + cliente mobile
@qr-device-flow/storage-redis  ⏳ A FAZER  - implementação Redis do ChallengeStorage
```

Além disso, podem existir adapters finos para frameworks web (Express, Fastify, Hono) como pacotes separados, e wrappers de UI (React, Vue, Svelte) sobre `@qr-device-flow/web`.

## 4. O que já foi construído

### `@qr-device-flow/core`

Kernel puro do protocolo. Sem I/O, sem framework, sem dependências runtime.

Módulos:
- `types.ts` — `Challenge`, `ChallengeStatus`, `ChallengeEvent`, `DeviceCodeResponse`, `RequesterInfo`, `ProtocolError`
- `constants.ts` — TTLs, alfabetos, patterns regex
- `state-machine.ts` — função `transition(current, event, now)` pura
- `codes.ts` — `generateDeviceCode()`, `generateUserCode()`, `normalizeUserCode()`, `assertValidDeviceCode()`
- `index.ts` — entrypoint público (só tipos e constantes)
- `server.ts` — entrypoint restrito (máquina de estados e geradores)

**Dual export no package.json:** integradores web e mobile importam de `@qr-device-flow/core` (só tipos), integradores server importam também de `@qr-device-flow/core/server`. Isso evita que lógica sensível vaze para bundles de cliente.

**Estados da máquina:**
```
pending ──SCAN──▶ scanned ──APPROVE──▶ approved ──CONSUME──▶ approved-consumed
   │                 │                      │
   │                 └──DENY──▶ denied      │
   │                                        │
   └──EXPIRE──▶ expired ◀──(TTL elapsed)────┘
```

Terminais: `approved-consumed`, `denied`, `expired`. Nenhum evento os tira desses estados.

**54 testes passando.** Cobrem todas as transições válidas e inválidas, expiração (incluindo boundary exato), sticky terminals, geração de códigos (formato, entropia, ausência de chars ambíguos `0/O/1/I/L`), validação, round-trip.

### `@qr-device-flow/server`

Motor HTTP-agnostic que orquestra storage + core + adapters do integrador.

Módulos:
- `server.ts` — classe `DeviceFlowServer` com métodos `createChallenge`, `markScanned`, `approve`, `deny`, `consume`, `getStatus`
- `storage.ts` — interface `ChallengeStorage` (contrato de persistência)
- `storage/memory.ts` — `MemoryStorage` para tests e dev local
- `index.ts` — entrypoint público

**Pontos de integração (adapters que o usuário final fornece):**
1. `storage: ChallengeStorage` — onde persistir challenges. Precisa de `compareAndSwap` atômico.
2. `issueSession: ({ userId, challenge }) => Promise<IssuedSession>` — o callback que emite o token de sessão final usando o sistema de auth já existente do integrador.
3. `verificationUri: string` — URL pública onde o app mobile pousa ao ler o QR.

**O servidor NÃO mexe em senhas, signup, recovery.** Ele só recebe "esse user aprovou esse code" e chama o adapter pra emitir sessão. Fica 100% fora do caminho do auth system do integrador.

**Proteção contra race:** o método `consume` usa retry loop com `compareAndSwap` pra garantir que só um consumidor ganha a sessão, mesmo sob concorrência. O mesmo vale para `approve`, `deny`, `markScanned`.

**20 testes passando.** Cobrem: happy path, fast path (sem SCAN), polling, single-use, expiração, input malformado, passagem correta de contexto ao `issueSession`.

## 5. O que falta construir (em ordem de prioridade)

### 5.1. `@qr-device-flow/web` — CLIENTE BROWSER (próximo passo natural)

API alvo (design já pensado):
```ts
import { QRDeviceFlow } from "@qr-device-flow/web";

const flow = new QRDeviceFlow({
  endpoint: "https://api.example.com/device",
  transport: "websocket", // "websocket" | "sse" | "polling"
  onStateChange: (state) => {},          // pending | scanned | approved | expired | denied
  onApproved: ({ accessToken }) => {},
  onError: (err) => {},
});

flow.start({ container: "#qr-box" });
// ou
const { qrDataUrl, userCode, expiresAt } = await flow.startHeadless();
```

Requisitos:
- Zero dependências runtime. Gera o QR internamente (pode usar uma lib tipo `qrcode` como dep, ou gerar SVG puro)
- Framework-agnostic. Bindings React/Vue/Svelte são pacotes separados
- Três transports: WebSocket (ideal), SSE (fallback), polling (último recurso — respeita o `interval` do RFC)
- Tratamento de expiração com regeneração automática opcional
- Usa os tipos de `@qr-device-flow/core` (nunca importa de `/server`)

Para construir:
1. Crie `/home/claude/qr-device-flow-web/` com a mesma estrutura dos outros pacotes
2. `package.json` com `"dependencies": { "@qr-device-flow/core": "file:../qr-device-flow-core" }`
3. Implemente a classe `QRDeviceFlow` com máquina de estados do cliente
4. Use `fetch` para chamar o endpoint `/device/code` e `/device/consume`
5. Abstraia o transport atrás de uma interface interna (polling/sse/ws implementam a mesma interface)
6. Testes com `happy-dom` ou `jsdom` + mocks de fetch/WebSocket
7. Publique QR como `data:image/svg+xml` ou canvas (escolha do dev via option)

Observação: a lógica do cliente tem sua própria máquina de estados menor (sem terminais `consumed`) — ele só precisa saber quando o servidor aprovou e fazer o consume. Reaproveite `ChallengeStatus` do core.

### 5.2. `@qr-device-flow/react-native` — CLIENTE MOBILE

API alvo:
```tsx
<QRScanner
  onScan={async (userCode) => {
    const details = await client.fetchChallengeDetails(userCode);
    const approved = await showConfirmationSheet(details);
    if (approved) await client.approve(userCode);
  }}
/>
```

**Requisito de segurança NÃO negociável:** a lib NÃO oferece `autoApprove`. A aprovação sempre passa por uma tela de consentimento que mostra `requesterInfo` (browser, SO, localização aproximada). Essa decisão é arquitetônica, não configurável.

Para construir:
1. Criar `/home/claude/qr-device-flow-rn/` com estrutura idêntica
2. Usar `expo-barcode-scanner` ou `react-native-vision-camera` como peer dependency
3. Cliente é similar ao web mas usando auth token do app mobile no header
4. Componente `<QRScanner>` é um wrapper com UX padrão, mas o hook `useDeviceFlowClient` permite composição custom
5. Nunca expor `autoApprove` ou similar

### 5.3. POC end-to-end (opcional mas muito útil)

Antes ou depois de publicar, construir um exemplo rodável que valida tudo:
- Servidor Express/Fastify usando `@qr-device-flow/server` com MemoryStorage
- HTML estático com `@qr-device-flow/web` rodando
- Simulação do mobile: segunda aba do browser com botão "aprovar" chamando o endpoint diretamente
- `docker-compose up` idealmente, rodando em localhost

Isso vira o `/examples/express-vanilla/` no monorepo e serve de smoke test.

### 5.4. `@qr-device-flow/storage-redis`

Implementação do `ChallengeStorage` usando Redis. O detalhe crítico é o `compareAndSwap` atômico via script Lua ou `WATCH/MULTI/EXEC`. Referência mental: é o mesmo padrão que libs de lock distribuído fazem.

## 6. Decisões de design já tomadas (NÃO revisitar sem motivo forte)

- **Seguir RFC 8628 em vez de inventar protocolo.** Compatibilidade com ecossistema OAuth existente. Um cliente RFC 8628 padrão (ex: `gh auth login`) funciona no nosso servidor sem adaptação.
- **TTL máximo de 600s, não configurável acima disso.** Limite de phishing. Integradores podem reduzir, nunca aumentar além do teto.
- **`user_code` sem caracteres ambíguos.** Alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 chars). Nada de `0/O/1/I/L` porque o usuário pode precisar digitar como fallback.
- **`device_code` de 256 bits em base64url (43 chars).** Padrão de identificadores opacos.
- **`compareAndSwap` no storage, não no core.** O core é puro. Atomicidade é responsabilidade do storage usando primitivas nativas do backend (Redis Lua, Postgres `SELECT FOR UPDATE`, Dynamo `ConditionExpression`).
- **`issueSession` é callback do integrador, não lógica da lib.** A lib NUNCA emite tokens. Ela só sinaliza "esse user aprovou" e deixa o auth system do integrador fazer o que ele já faz.
- **Dual export (`.` e `./server`) no core.** Evita que `transition()` e geradores de código vazem para bundles de browser/mobile.
- **`requesterInfo` é advisório.** Mostrado ao usuário no mobile para consentimento, mas nunca usado para decisão de auth. Usuário humano é quem decide.
- **Scripts são puros.** `transition(current, event, now)` recebe `now` injetado pra ser determinístico sob teste. Storage é pluggable. Isso permite testes unitários sem I/O.

## 7. Restrições de segurança que têm que se manter

- **HTTPS obrigatório em produção.** A lib deve recusar rodar em HTTP exceto em localhost.
- **Rate limiting no endpoint de criação de challenge.** Protege contra DoS de criação. O server atual não implementa — é responsabilidade do integrador por ora, mas um adapter de rate limit pode ser adicionado no futuro.
- **`userId` em `approve()` SEMPRE vem da sessão autenticada do mobile, nunca de request params.** Documentar isso explicitamente no README.
- **Device binding no `requesterInfo`.** Mostrar ao usuário no celular antes de aprovar. Nunca auto-aprovar.
- **Single-use garantido por `compareAndSwap`.** Testes de `single-use semantics` em `server.test.ts` cobrem isso.

## 8. Como reproduzir o estado atual

```bash
# Extrair o zip
unzip qr-device-flow.zip
cd qr-device-flow

# Instalar e testar o core
cd qr-device-flow-core
npm install
npx vitest run   # deve passar 54 testes

# Instalar e testar o server (depende do core)
cd ../qr-device-flow-server
npm install
npx vitest run   # deve passar 20 testes
```

Ambos usam TypeScript strict, ES2022, module ESNext, moduleResolution bundler. Node 20+ necessário por causa de `globalThis.crypto.getRandomValues` nativo.

## 9. Checklist para próxima sessão de desenvolvimento

Se o objetivo for `@qr-device-flow/web`:
- [ ] Ler `src/types.ts` e `src/constants.ts` do core para saber o contrato
- [ ] Ler `src/server.ts` do server para entender os endpoints esperados (ainda implícitos — podemos formalizar como um arquivo `PROTOCOL.md` separado)
- [ ] Decidir se gerar QR como SVG puro (zero deps) ou usar `qrcode` como dep
- [ ] Esboçar API pública e escrever testes primeiro
- [ ] Implementar os três transports (polling primeiro, é o mais simples; depois WS/SSE)

Se o objetivo for formalizar endpoints HTTP do server:
- [ ] Criar `PROTOCOL.md` listando endpoints, métodos, query/body params, respostas por código
- [ ] Opcional: adapter Express em `@qr-device-flow/server-express` que expõe os métodos da classe como handlers HTTP

Se o objetivo for POC end-to-end:
- [ ] Criar `/examples/express-vanilla/` com servidor + página + simulador
- [ ] Adicionar script `npm run demo` no root

## 10. Onde cada coisa mora

```
qr-device-flow-core/
├── package.json              # dual exports "." e "./server"
├── tsconfig.json             # strict, ES2022, moduleResolution bundler
├── src/
│   ├── types.ts              # Challenge, ChallengeStatus, ProtocolError
│   ├── constants.ts          # TTLs, USER_CODE_ALPHABET, patterns
│   ├── state-machine.ts      # transition() pura — SERVER-ONLY
│   ├── codes.ts              # generateDeviceCode/UserCode — SERVER-ONLY
│   ├── index.ts              # exports públicos (tipos + constantes)
│   └── server.ts             # exports server (transition + geradores)
└── test/
    ├── state-machine.test.ts # 30 testes
    └── codes.test.ts         # 24 testes

qr-device-flow-server/
├── package.json              # depende de core via file:../
├── tsconfig.json
├── src/
│   ├── server.ts             # DeviceFlowServer
│   ├── storage.ts            # interface ChallengeStorage
│   ├── storage/memory.ts     # MemoryStorage (ref impl)
│   └── index.ts
└── test/
    └── server.test.ts        # 20 testes
```

## 11. Pronto para continuar?

Recomendação para a próxima sessão: escolher **um** dos três caminhos da seção 5, começar por testes da API pública desejada, só depois implementar. O protótipo inteiro foi construído nesse padrão e funcionou bem.

Boa sorte — e lembre-se: o valor da lib está em ser RFC-compliant e minimalista, não em cobrir todos os casos imagináveis.
