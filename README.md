# Notification Request System

Хэрэглэгч бүр өөрийн notification хүсэлтийг илгээж, status-ийн өөрчлөлтийг **WebSocket**-ээр
шууд (polling-гүй) хүлээн авдаг serverless full-stack аппликейшн.

- **Frontend:** React + Vite + TypeScript. HTTPS дээр API Gateway-ийн `web` Lambda-аас үйлчилнэ (Vercel-д ч deploy хийж болно, [доор](#2-frontend))
- **Backend:** AWS Lambda, API Gateway (HTTP + WebSocket), DynamoDB, SQS, Cognito. Serverless Framework v3
- **Live demo:** https://mb8qvsd64b.execute-api.ap-southeast-2.amazonaws.com (дурын имэйлээр бүртгүүлж болно, имэйл баталгаажуулалтгүй)
  Туршихдаа хүлээн авагчид `fail@…`, `flaky@…`, `outage@…` гэж бичвэл алдааны замууд харагдана.

## Агуулга

1. [Ажиллах зарчим](#ажиллах-зарчим)
2. [Нэвтрэлт ба эрх](#нэвтрэлт-ба-эрх)
3. [WebSocket-ийн шийдвэр](#websocket-ийн-шийдвэр)
4. [Өгөгдлийн загвар ба pagination](#өгөгдлийн-загвар-ба-pagination)
5. [Найдвартай байдал](#найдвартай-байдал)
6. [IAM эрх](#iam-эрх)
7. [API ба message бүтэц](#api-ба-message-бүтэц)
8. [Deploy хийх заавар](#deploy-хийх-заавар)
9. [Тест ба бодит орчны шалгалтын үр дүн](#тест-ба-бодит-орчны-шалгалтын-үр-дүн)
10. [Хязгаарлалт](#хязгаарлалт)

## Ажиллах зарчим

```
Browser ──POST /notifications (JWT)──► createNotification λ
                                          1. validate, DynamoDB-д хадгална (PENDING)
                                          2. SQS-д { id } илгээнэ
                                                ▼
   DynamoDB ◄── 4. нөхцөлт update ── worker λ ◄── SQS ──(3 удаа алдвал)──► DLQ ──► dlqProcessor λ
                                          │
                  5. status өөрчлөгдөх бүрт зөвхөн эзэмшигчид WebSocket-ээр push
                                          ▼
                                       Browser
```

```
PENDING ──► PROCESSING ──► COMPLETED
   ▲             │
   └─ (түр зуурын алдаа, дахин оролдоно)
                 └──► FAILED
```

Хүргэлт нь **симуляци** (`backend/src/lib/deliver.ts`). Хүлээн авагчийн хаяг үр дүнг тодорхойлдог тул
алдааны бүх замыг демо хийж болно:

| Хүлээн авагч | Үр дүн |
|---|---|
| ердийн хаяг | `COMPLETED` |
| `fail@…` | Байнгын алдаа: шууд `FAILED`, дахин оролдохгүй |
| `flaky@…` | Түр зуурын алдаа: 1, 2-р оролдлого унаж, 3-р оролдлогод `COMPLETED` |
| `outage@…` | Түр зуурын алдаа үргэлж: 3 оролдлогын дараа `FAILED` |

## Нэвтрэлт ба эрх

- **Cognito user pool** (имэйл + нууц үг). Frontend нь Cognito руу шууд (`SignUp`, `InitiateAuth`)
  хандаж, **ID token** авна. Token дуусахаас өмнө `refresh token`-оор автоматаар шинэчилнэ.
- **HTTP API:** API Gateway-ийн **JWT authorizer** (issuer, audience, signature, хугацаа). Token-гүй
  эсвэл хуурамч хүсэлт Lambda-д хүрэхээсээ өмнө `401` авна.
- **WebSocket API:** API Gateway-д JWT authorizer байхгүй тул `$connect` дээр **Lambda authorizer**
  (`wsAuthorizer`, `aws-jwt-verify`) ашигласан. Browser WebSocket-д header тавьж чаддаггүй тул token
  нь `?token=` query-д явна (зөвхөн `wss://`).
- **Эзэмшил:** Бүх notification-д `userId` (token-ий `sub`) хадгалагдана. `userId`-г **зөвхөн token-оос**
  авна, request body-д илгээсэн `userId`-г үл тооно. Жагсаалт, pagination cursor, WebSocket push бүгд
  `userId`-аар хязгаарлагдана: өөр хэрэглэгчийн өгөгдлийг харах, cursor-оор нь орох боломжгүй.
- **Нэвтрэх үеийн алдаа:** Бүртгэлгүй имэйлд "Энэ имэйлээр бүртгэл олдсонгүй. Бүртгүүлнэ үү.", бүртгэлтэй
  имэйлийн буруу нууц үгэнд "Имэйл эсвэл нууц үг буруу байна." гэж ялгаж харуулна. Үүний тулд Cognito-ийн
  `PreventUserExistenceErrors: LEGACY`. Хямдрал: халдагч аль имэйл бүртгэлтэй гэдгийг таах боломжтой болно
  (sign-up ч "бүртгэлтэй" гэж хэлдэг тул эрсдэл бүрэн шинэ биш). Нуух бол `ENABLED` болгоход хоёр тохиолдол
  хоёулаа "имэйл эсвэл нууц үг буруу" болно.
- **Demo-ийн хялбарчлал:** `preSignUp` trigger нь шинэ хэрэглэгчийг имэйл баталгаажуулалтгүй шууд
  баталгаажуулна. Production-д энэ trigger-ийг авч, Cognito-ийн баталгаажуулах кодыг ашиглана.

## WebSocket-ийн шийдвэр

- **Connection ID хадгалах:** `$connect` үед `connectionId` ба `userId`-г DynamoDB `Connections`
  хүснэгтэд хадгална, `$disconnect` үед устгана. Lambda stateless тул холбогдсон хэрэглэгчдийг shared
  store-д хадгалах шаардлагатай.
- **Client-д хүргэх:** Worker status өөрчлөх бүрт тухайн notification-ий эзэмшигчийн холболтуудыг
  `Connections`-ийн `byUser` индексээр **Query** хийж (scan биш), холболт бүрт API Gateway Management
  API-ийн `PostToConnection`-оор message илгээнэ. Хэрэглэгч хэд хэдэн tab нээсэн бол бүгд шинэчлэгдэнэ.
- **Салсан холболт:** Сүлжээ тасрах, компьютер унтрах үед `$disconnect` ирэхгүй байж болно. Тэр үед
  `PostToConnection` нь `410 Gone` буцааж, холболтыг тэр дор нь устгана. Нэмэлтээр `expiresAt` (3 цаг)
  гэсэн **DynamoDB TTL** бий. API Gateway холболтыг дээд тал нь 2 цагт таслах тул TTL амьд холболтыг
  устгахгүй.
- **Алдаа тусгаарлах:** `Promise.allSettled` ашигласан тул нэг client-ийн алдаа бусдад нөлөөлөхгүй.
  Push-ийн алдаа worker-ийг унагаахгүй, учир нь status аль хэдийн хадгалагдсан.
- **Дахин холбогдох (frontend):** Exponential backoff-оор (1с → 15с хүртэл), оролдлого бүрт **шинэ
  token**-оор. Холбогдсоны дараа жагсаалтыг дахин татаж, тасарсан үед алдсан update-ээ нөхнө.
- **Дараалал:** Push нь `POST`-ийн хариунаас түрүүлж ирж болно. UI нь `updatedAt` нь шинэ хувилбарыг л
  хадгална.

## Өгөгдлийн загвар ба pagination

| Хүснэгт / индекс | Түлхүүр | Зориулалт |
|---|---|---|
| `Notifications` | `id` (PK) | Нэг хүсэлт = нэг мөр. Worker `id`-аар хандана |
| `Notifications` · `byUser` | `userId` (PK), `createdAt` (SK) | «Миний хүсэлтүүд, шинэ нь эхэнд»: нэг `Query` = нэг хуудас |
| `Notifications` · `byStatus` | `status` (PK), `updatedAt` (SK), KEYS_ONLY | Sweeper удаан `PENDING` байгааг scan-гүй олно |
| `Connections` | `connectionId` (PK), TTL `expiresAt` | Нээлттэй WebSocket бүр |
| `Connections` · `byUser` | `userId` (PK), `connectionId` (SK), KEYS_ONLY | Хэрэглэгчийн бүх tab-ийг олно |

**Pagination:** `GET /notifications?limit=20&nextToken=…`. `limit` нь 1–50. `nextToken` нь DynamoDB-ийн
`LastEvaluatedKey` (base64url). Cursor нь client-ээс ирдэг тул **итгэхгүй**: бүтэц нь зөв, `userId` нь
дуудаж буй хэрэглэгчтэй таарч байх ёстой, үгүй бол `400`. Ингэснээр cursor-ыг өөрчилж бусдын өгөгдөл рүү
орох боломжгүй.

## Найдвартай байдал

**Алдааны хоёр төрөл** (`backend/src/lib/errors.ts`). Worker тэдгээрийг өөр өөрөөр боловсруулна.

| Төрөл | Жишээ | Worker юу хийх вэ |
|---|---|---|
| **Байнгын** (`PermanentDeliveryError`) | Хаяг буруу, хүлээн авагч татгалзсан | Шууд `FAILED`, message-ийг баталгаажуулж устгана |
| **Түр зуурын** (`TemporaryDeliveryError`) ба ангилаагүй алдаа | Provider унасан, timeout | `PENDING` руу буцааж (`release`), SQS-д backoff-той (5с, 10с, 20с…) дахин хүргүүлнэ. Оролдлого дуусвал `FAILED: 3 оролдлогын дараа бууж өгөв` |

**Retry:** SQS-ийн `ApproximateReceiveCount` нь оролдлогын тоо. Түр зуурын алдаа гарвал worker
`ChangeMessageVisibility`-ээр дараагийн хүргэлтийг backoff хугацаанд тохируулна (6 минутын default-ыг
хүлээхгүй). **Partial batch response** (`ReportBatchItemFailures`) ашигласан тул batch дахь нэг алдаатай
record бусдыг дахин хүргүүлэхгүй.

**Давхар боловсруулалт ба зэрэгцээ ажиллагаа:** SQS нэг message-ийг хоёр удаа өгч болно. Бүх status
шилжилт нь **нөхцөлтэй `UpdateItem`** (`backend/src/lib/notificationStore.ts`):

- `claim`: `PENDING` (эсвэл 2 минутаас удаан хөдөлгөөнгүй `PROCESSING`) → `PROCESSING`
- `finish`: `PROCESSING` → `COMPLETED` / `FAILED`
- `release`: `PROCESSING` → `PENDING`

Хоёр worker өрсөлдвөл DynamoDB нэгийг нь л зөвшөөрч, нөгөөгийн нөхцөл бүтэлгүйтэж алгасна.
Worker дундаа унавал 2 минутын lease (Lambda timeout 60с-ээс урт) дараа өөр worker авна.

**Dead-letter queue:** Worker өөрөө дуусгаж чадаагүй message (унасан, timeout, уншигдахгүй) 3 удаагийн
дараа DLQ руу орно. `dlqProcessor` Lambda нь тэр notification-г `FAILED` болгож эзэмшигчид мэдэгдэнэ.
Үгүй бол notification үүрд `PROCESSING`-д гацна.

**DynamoDB ба SQS хоёрын partial failure.** Хоёуланд нэг transaction хийх боломжгүй. Тиймээс:

1. DynamoDB-д бичих нь **commit point**: хадгалагдсан бол хүсэлт алдагдахгүй.
2. SQS-д илгээж чадаагүй бол item `PENDING` хэвээр үлдэж `202` буцна (`201` биш).
3. `requeueStale` Lambda **5 минут тутам** 2 минутаас удаан `PENDING` байгаа item-үүдийг `byStatus`
   индексээр олж дахин queue-д оруулна. Давхар оруулах нь аюулгүй, учир нь worker-ийн claim давхарыг алгасна.

**Idempotency:** `Idempotency-Key` header-тэй `POST`-д item-ийн `id` нь `sha256(userId + key)`-ээс
гарна, `PutItem` нь `attribute_not_exists(id)` нөхцөлтэй. Timeout, давхар дарах, хариу алдагдсаны улмаас
давтагдсан хүсэлт хоёр дахь notification үүсгэхгүй, анхных нь `200`-аар буцна. Түлхүүр нь **нэг хүсэлтийг**
төлөөлнэ: ижил түлхүүрийг **өөр агуулгатай** хүсэлтэд ашиглавал `409 idempotency_key_reused` (өөр хүсэлтийн
мөрийг чимээгүй буцаахгүй). Frontend түлхүүрийг хүсэлтийн агуулгатай нь холбодог: агуулгыг засвал шинэ түлхүүр.

**Хяналт, нөөцлөлт, хязгаар:**

| Юу | Хэрхэн |
|---|---|
| **Alarm** | `DeadLetterAlarm` (`dlqProcessor` ажилласан бол), `WorkerErrorsAlarm`, `ApiErrorsAlarm` (Lambda `Errors`). SNS topic-д холбогдсон; `ALARM_EMAIL=… npx serverless deploy` гэвэл имэйл ирнэ |
| **Rate limit** | HTTP болон WebSocket API-ийн stage бүр 25 хүсэлт/сек, burst 50 |
| **Зэрэгцээ ажиллагаа** | Worker хамгийн ихдээ 5 зэрэг (`maximumConcurrency`), ингэснээр ачааллын үед DynamoDB, WebSocket API-г дарамтлахгүй |
| **Хадгалах хугацаа** | `Notifications` мөр 90 хоногийн дараа TTL-ээр устна; `Connections` 3 цагийн дараа |
| **Нөөцлөлт** | `Notifications` дээр point-in-time recovery |

## IAM эрх

Функц бүр **өөрийн role**-той (`serverless-iam-roles-per-function`, `defaultInherit: false`) ба зөвхөн
өөрт хэрэгтэй үйлдлийг, зөвхөн тэр нөөцөд эдэлнэ. Wildcard resource байхгүй (WebSocket-ийн
`ManageConnections` нь зөвхөн энэ API-ийн `POST /@connections/*`).

**Аудит:** энэ хүснэгтийг `scripts/e2e.mjs` бодитоор шалгадаг: функц бүрийн role-ийг AWS-ээс уншиж, зөвшөөрсөн
үйлдлийг дээрх хүснэгттэй яг тулгаж, `"*"` нөөц, role хуваалцсан эсэхийг шалгана. Энэ аудит анхны хувилбарын
алдааг илрүүлсэн: `statement`-гүй `wsAuthorizer`, `preSignUp` нь нийтлэг role руу орж, өөрт хэрэггүй
`ManageConnections` болон SQS унших эрхтэй байсан. Одоо хоосон `iamRoleStatements: []`-ээр тусдаа, зөвхөн
лог бичих role авсан.

| Функц | DynamoDB | SQS | Бусад |
|---|---|---|---|
| `createNotification` | `Notifications`: PutItem, GetItem | `SendMessage` (queue) | |
| `listNotifications` | `Notifications/index/byUser`: Query | | |
| `worker` | `Notifications`: UpdateItem · `Connections/index/byUser`: Query · `Connections`: DeleteItem | Receive, Delete, GetQueueAttributes, ChangeMessageVisibility (queue) | `execute-api:ManageConnections` |
| `dlqProcessor` | `worker`-тэй ижил | Receive, Delete, GetQueueAttributes (**DLQ**) | `execute-api:ManageConnections` |
| `requeueStale` | `Notifications/index/byStatus`: Query | `SendMessage` (queue) | |
| `wsConnect` | `Connections`: PutItem | | |
| `wsDisconnect` | `Connections`: DeleteItem | | |
| `web` | | | Зөвхөн лог бичих (файлыг өөрийн package-аасаа уншина) |
| `wsAuthorizer`, `preSignUp` | | | Зөвхөн лог бичих |

## API ба message бүтэц

Бүх HTTP хүсэлтэд `Authorization: Bearer <ID token>` хэрэгтэй.

**Notification** (DynamoDB, API хариу, WebSocket message гурвуулаа ижил хэлбэртэй):

```json
{
  "id": "5f0c9a52-6c1d-4d3e-9b1a-2d6f1c3e8a77",
  "userId": "c99eb4d8-50e1-70eb-0b86-b6def0dd1613",
  "recipient": "bold@example.com",
  "channel": "Имейл",
  "message": "Hello",
  "status": "COMPLETED",
  "result": "Имейл сувгаар bold@example.com хаяг руу амжилттай хүргэлээ",
  "attempts": 1,
  "createdAt": "2026-11-16T04:34:03.120Z",
  "updatedAt": "2026-11-16T04:34:06.431Z"
}
```

`channel`: `EMAIL | SMS | PUSH`. `status`: `PENDING | PROCESSING | COMPLETED | FAILED`.

**`POST /notifications`**

```bash
curl -X POST "$API_URL/notifications" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6f1b0c1e-9f4a-4c1d-8d3e-0a1b2c3d4e5f" \
  -d '{"recipient":"bold@example.com","channel":"EMAIL","message":"Hello"}'
```

| Код | Хариу | Үед |
|---|---|---|
| `201` | Notification (`PENDING`) | Хадгалагдаж, queue-д орсон |
| `202` | Notification (`PENDING`) | Хадгалагдсан, queue-д орох нь хойшилсон (sweeper орууллана) |
| `200` | Анхны notification | Ижил `Idempotency-Key`-тэй, ижил агуулгатай давтан хүсэлт |
| `409` | `{ "code": "idempotency_key_reused", … }` | Ижил `Idempotency-Key`-г өөр агуулгатай хүсэлтэд ашигласан |
| `400` | `{ "code": "recipient_required", "error": "recipient is required" }` гэх мэт | Буруу JSON, validate алдаа (channel, **сувгаас хамаарсан хүлээн авагчийн хэлбэр**, 500-аас урт message), буруу `Idempotency-Key`. Кодын жагсаалт доор |
| `401` | `{ "message": "Unauthorized" }` (API Gateway) | Token байхгүй, хуурамч, хугацаа дууссан |

**Хүлээн авагчийн хэлбэр (суваг тус бүр):** `EMAIL` нь `нэр@домэйн.төрөл` (254 хүртэл тэмдэгт), `SMS` нь 8-15 оронтой
утасны дугаар (`+` ба зай, зураас зөвшөөрнө), `PUSH` нь хоосон зайгүй 3-128 тэмдэгт. Шалгалт сервер дээр.

**`GET /notifications?limit=20&nextToken=…`** → `200 { "items": [Notification…], "nextToken": "…" }`
(`nextToken` нь сүүлийн хуудсанд байхгүй). Буруу `limit`, `nextToken` → `400`.

**WebSocket:** `wss://<ws-api>/dev?token=<ID token>`. Client юу ч илгээхгүй. Server нь status өөрчлөгдөх
бүрт эзэмшигчид нэг message илгээнэ:

```json
{ "type": "NOTIFICATION_UPDATED", "notification": { "id": "…", "status": "PROCESSING", "…": "…" } }
```

**SQS message:** `{ "id": "<notification id>" }`. Зөвхөн id, учир нь жинхэнэ эх сурвалж нь DynamoDB.

### Алдааны код ба хэл

API-ийн алдаа бүр **тогтвортой `code`** ба хөгжүүлэгчид зориулсан **англи `error`** тайлбартай. Хэрэглэгчид
харагдах монгол текстийг frontend `code`-оор сонгоно (`frontend/src/i18n.ts`), тиймээс сервер хэлнээс
хамаарахгүй, хэл нэмэхэд backend-д хүрэхгүй.

| `code` | Үед | Хэрэглэгчид харагдах текст |
|---|---|---|
| `invalid_json`, `invalid_body` | Body JSON биш, объект биш | Хүсэлтийн бүтэц буруу байна. |
| `recipient_required` | Хүлээн авагч хоосон | Хүлээн авагчийг бөглөнө үү. |
| `invalid_recipient_email` | `EMAIL` суваг, имэйлийн хэлбэргүй (`asdf`, `bold@gmail`) | Имэйл хаяг буруу байна (жишээ нь bold@gmail.com). |
| `invalid_recipient_phone` | `SMS` суваг, 8-15 оронтой дугаар биш | Утасны дугаар буруу байна (жишээ нь +97699112233 эсвэл 99112233). |
| `invalid_recipient_device` | `PUSH` суваг, 3-128 тэмдэгт биш эсвэл хоосон зайтай | Төхөөрөмжийн ID 3-128 тэмдэгт байх ёстой бөгөөд хоосон зай агуулж болохгүй. |
| `invalid_channel` | `EMAIL`, `SMS`, `PUSH`-ээс өөр суваг | Сувгаа зөв сонгоно уу. |
| `message_required` | Мессеж хоосон | Мессежээ бичнэ үү. |
| `message_too_long` | 500 тэмдэгтээс урт | Мессеж хэт урт байна (дээд тал нь 500 тэмдэгт). |
| `invalid_idempotency_key` | Буруу хэлбэрийн түлхүүр | Хүсэлтийн давхардлаас хамгаалах түлхүүр буруу байна. |
| `idempotency_key_reused` | Түлхүүрийг өөр агуулгатай хүсэлтэд ашигласан | Энэ түлхүүрээр өөр агуулгатай хүсэлт аль хэдийн илгээгдсэн байна. Дахин оролдоно уу. |
| `invalid_limit`, `invalid_next_token` | Буруу `limit`, cursor | Жагсаалтын хэмжээ буруу байна. / Жагсаалтыг дахин ачаална уу. |
| `unauthorized` | Хэрэглэгч тодорхойгүй | Нэвтрэх шаардлагатай. |

Frontend-ийн мэдэхгүй код ирвэл англи тайлбарыг хэрэглэгчид үзүүлэхгүй, ерөнхий "Алдаа гарлаа" гэж харуулна.
Хүргэлтийн `result` (картан дээр харагддаг) ба нэвтрэлтийн алдаа монгол хэлээр. Код, лог, `curl`, API-ийн
`error` тайлбар англи, тестийн нэр монгол.

## Deploy хийх заавар

Шаардлага: Node.js 22+, AWS account (`aws configure`), `npm install -g serverless@3`.

### 1. Backend (AWS)

```bash
cd backend
npm install
npm test
npx serverless deploy
```

Region нь `backend/serverless.yml` дахь `provider.region` (одоо `ap-southeast-2`). Deploy дууссаны дараа
endpoint-ууд хэвлэгдэнэ:

```
POST - https://<http-api-id>.execute-api.<region>.amazonaws.com/notifications
GET  - https://<http-api-id>.execute-api.<region>.amazonaws.com/notifications
wss://<ws-api-id>.execute-api.<region>.amazonaws.com/dev
```

Cognito-ийн ID-г авна:

```bash
aws cloudformation describe-stacks --stack-name notification-system-dev --region <region> \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text
```

> **Анхаар:** GSI нэмсэн анхны deploy-н дараа DynamoDB индексийг ард нь бүтээдэг (backfill) ба хэдэн
> минутын турш уншигдахгүй. Энэ хугацаанд `requeueStale` алдаа гаргаж болох ч дараагийн ажиллалтаар
> засрана. Хоёр индексийг нэг шинэчлэлтээр нэмэх боломжгүй (CloudFormation-ийн хязгаар).

### 2. Frontend

**Үндсэн арга: нэг команд, нэг HTTPS хаяг.** Build хийж, backend-тэй хамт API Gateway-ийн `web` Lambda-аар
үйлчилнэ (`/` дээр). Frontend ба API нэг origin тул CORS хэрэггүй.

```bash
./scripts/deploy-frontend.sh      # нэмэлт: STAGE=dev AWS_REGION=ap-southeast-2
```

Скрипт нь stack-ийн output-оос (`HttpApiUrl`, `ServiceEndpointWebsocket`, `UserPoolClientId`) `VITE_*`
хувьсагчдыг өөрөө авч, `frontend`-ийг build хийгээд `backend/web`-д хуулж, `serverless deploy` ажиллуулна.
Төгсгөлд хаяг хэвлэнэ. `web` Lambda нь hash-тэй asset-ийг 1 жил cache хийлгэж, `index.html`-ийг үргэлж
шинэчилнэ, gzip шахна, мөн өөрийн Content-Security-Policy, HSTS, `X-Frame-Options` header-уудыг тавина.

> **Яагаад S3 + CloudFront биш вэ?** Хамгийн түрүүнд CloudFront-ыг оролдсон (`FrontendDistribution`). AWS шинэ
> account-д үүнийг хориглосон: *"Your account must be verified before you can add new CloudFront resources"*.
> Үүнийг зөвхөн AWS Support шийднэ. Тиймээс `web` Lambda-г сонгосон. Account баталгаажсаны дараа S3 + CloudFront
> руу шилжих нь илүү хямд, хурдан (CDN). Энэ нь `scripts/deploy-frontend.sh`-ийг л солино, backend хэвээр.

**Өөр арга: Vercel.**

1. Repository-г GitHub-д түлхэнэ.
2. https://vercel.com → **Add New… → Project** → repository-г сонгоно.
3. **Root Directory:** `frontend`. Framework нь Vite гэж автоматаар танигдана (Build `npm run build`,
   Output `dist`).
4. **Environment Variables**:

| Хувьсагч | Утга |
|---|---|
| `VITE_API_URL` | HTTP API-ийн origin, жишээ нь `https://<http-api-id>.execute-api.<region>.amazonaws.com` |
| `VITE_WS_URL` | `wss://<ws-api-id>.execute-api.<region>.amazonaws.com/dev` |
| `VITE_COGNITO_REGION` | `<region>`, жишээ нь `ap-southeast-2` |
| `VITE_COGNITO_CLIENT_ID` | Cognito-ийн `UserPoolClientId` |

5. **Deploy**, дараа нь CORS-д Vercel-ийн хаягийг нэмнэ (доор).

### 3. CORS

Анхдагчаар зөвхөн API-ийн өөрийн origin (энэ stack-ийн `HttpApiUrl`) ба `http://localhost:5173` зөвшөөрөгдөнө;
`*` биш. Өөр газар (Vercel) байрлуулсан frontend-д:

```bash
cd backend
CORS_ORIGIN=https://<your-project>.vercel.app npx serverless deploy
```

Бусад хувьсагч: `ALARM_EMAIL` (alarm-ийн имэйл).

### 4. Local-д ажиллуулах

```bash
cd frontend
npm install
cp .env.example .env     # дээрх дөрвөн хувьсагчийг бөглөнө
npm run dev              # http://localhost:5173
```

### 5. Устгах

```bash
cd backend && npx serverless remove
```

## Тест ба бодит орчны шалгалтын үр дүн

### Unit тест

| Хэсэг | Тоо | Юуг шалгадаг |
|---|---|---|
| `backend` (`cd backend && npm test`) | **167** | validate (суваг тус бүрийн хүлээн авагчийн хэлбэр орно), handler бүр, worker-ийн retry/permanent/duplicate/batch, status шилжилтийн нөхцөл, pagination cursor, authorizer, broadcast, sweeper, DLQ, idempotency (409 орно), TTL, `web` handler (замын аюулгүй байдал, cache, gzip, CSP) |
| `frontend` (`cd frontend && npm test`) | **50** | Live update-ийн нийлүүлэлт (хуучин хувилбар шинийг дарахгүй), pagination, WebSocket дахин холбогдох ба backoff, token шинэчлэл, API клиент, idempotency түлхүүрийн логик |

AWS-ийн client-уудыг mock хийсэн тул credential шаардахгүй. Mock хийсэн DynamoDB нөхцөлт илэрхийллийг
өөрөө ажиллуулдаггүй тул тэдгээрийг доорх бодит орчны шалгалт баталгаажуулна.

### Deploy хийсэн орчин дээрх шалгалт

`scripts/e2e.mjs` нь бодит Cognito хэрэглэгч үүсгэж, бодит API ба WebSocket-ээр бүх замыг туршдаг.
Queue/DLQ-д шууд message илгээх, DynamoDB-д item үүсгэх зэрэг API-аар хийх боломжгүй алдааны
тохиолдлуудад AWS CLI ашиглана.

```bash
API_URL=https://<http-api-id>.execute-api.<region>.amazonaws.com \
WS_URL=wss://<ws-api-id>.execute-api.<region>.amazonaws.com/dev \
COGNITO_CLIENT_ID=<client id> \
node scripts/e2e.mjs
```

Үр дүн (`ap-southeast-2`, Node.js 22 runtime, **22/22 давсан**). Скрипт нь функц, role, индекс, alarm-ыг
бодитоор уншиж шалгадаг тул инфраструктурын тохиргоо (IAM, PITR, TTL, throttle) ч үүнд орсон:

| # | Шалгалт | Үр дүн | Хугацаа |
|---|---|---|---|
| 1 | Frontend: HTTPS дээр, CSP ба аюулгүй байдлын header-тэй, deep link index.html-ээр хариулна | PASS | 3.7 s |
| 2 | HTTP: token-гүй хүсэлт татгалзагдана (401) | PASS | 0.8 s |
| 3 | HTTP: хуурамч token татгалзагдана (401) | PASS | 0.3 s |
| 4 | WebSocket: token-гүй холболт татгалзагдана | PASS | 1.5 s |
| 5 | WebSocket: хуурамч token-тэй холболт татгалзагдана | PASS | 1.4 s |
| 6 | POST шалгалт: 400 ба тогтвортой алдааны код буцаана | PASS | 2.1 s |
| 7 | Хүлээн авагчийн хэлбэр: суваг тус бүрт имэйл, утас, төхөөрөмжийн ID шалгагдана | PASS | 2.5 s |
| 8 | Нэвтрэлт: бүртгэлгүй имэйл ба буруу нууц үгийг ялгаж хэлнэ | PASS | 2.9 s |
| 9 | Амжилт: нэг хэрэглэгчийн хоёр дахь tab ижил update-ийг авна | PASS | 2.3 s |
| 10 | Амжилт: PENDING -> PROCESSING -> COMPLETED, WebSocket-ээр, polling-гүй | PASS | 2.3 s |
| 11 | Байнгын алдаа: шууд FAILED, дахин оролдохгүй | PASS | 2.7 s |
| 12 | Түр зуурын алдаа: backoff-той дахин оролдож, 3-р оролдлогод COMPLETED | PASS | 24.8 s |
| 13 | Түр зуурын алдаа сэргэхгүй бол: сүүлийн оролдлогын дараа FAILED | PASS | 26.3 s |
| 14 | Тусгаарлалт: өөр хэрэглэгч бусдын notification, live update-ийг хардаггүй | PASS | 1.9 s |
| 15 | Тусгаарлалт: өөр хэрэглэгчийн pagination cursor татгалзагдана | PASS | 1.4 s |
| 16 | Pagination: 5 мөрийг 2-оор унших, шинэ нь эхэнд, давхардал ба алдагдалгүй | PASS | 3.5 s |
| 17 | Idempotency-Key: давтагдсан хүсэлт яг нэг notification үүсгэнэ | PASS | 2.0 s |
| 18 | Давхар SQS хүргэлт: notification яг нэг удаа боловсруулагдана | PASS | 17.1 s |
| 19 | Хэсэгчилсэн алдаа: SQS-д хүрээгүй PENDING мөрийг sweeper дахин оруулна | PASS | 10.7 s |
| 20 | Dead-letter queue: DLQ-д орсон notification FAILED болно | PASS | 5.4 s |
| 21 | IAM: функц бүр зөвхөн өөрт хэрэгтэй эрхтэй, "*" нөөц байхгүй (wsAuthorizer, preSignUp зөвхөн лог) | PASS | 43.1 s |
| 22 | Тохиргоо: PITR, TTL, API throttle ба хяналтын alarm-ууд идэвхтэй | PASS | 7.5 s |

Мөн React апп-ыг **deploy хийсэн HTTPS хаяг дээр** (CSP идэвхтэй) хөтөчөөр туршсан, console-д алдаагүй: хяналтын самбар `live` болж, `flaky@…` илгээхэд
карт `2-р оролдлого`, "1/3-р оролдлого амжилтгүй: … Дахин оролдоно." гэж харагдаад `3-р оролдлого`-д
`Дууссан` болсон. `fail@…` нь `Амжилтгүй`, хоосон форм нь "Хүлээн авагчийг бөглөнө үү." гэж харагдсан.

Тест хэрэглэгчид (`e2e-…@example.com`) Cognito user pool-д үлдэнэ. Хүсвэл Cognito console-оос устгаж болно.

## Хязгаарлалт

- **Имэйл баталгаажуулалтгүй sign-up** (`preSignUp` trigger). Зөвхөн demo-д зориулсан. Мөн имэйл хаягийн **хэлбэр**
  шалгагддаг боловч хаяг үнэхээр хүлээн авагчийнх эсэх нь баталгаажихгүй.
- **Хэрэглэгчийн бүртгэлтэй эсэх нь нэвтрэхэд ил гарна** (`PreventUserExistenceErrors: LEGACY`, дээр тайлбарласан).
- **Frontend нь CDN-гүй.** CloudFront-ыг AWS шинэ account-д хориглосон (дээрх тайлбар) тул `web` Lambda-аас
  үйлчилнэ. Хариу бүр Lambda-аар дамждаг тул хол хэрэглэгчид удаан, "cold start" эхний хүсэлтийг ~сек удаашруулна;
  хариу 6 MB-аас (API Gateway-ийн хязгаар) хэтэрч болохгүй. Одоогийн build ~75 KB (gzip).
- **Нэвтрэлт `USER_PASSWORD_AUTH` (нууц үг TLS-ээр Cognito руу).** SRP илүү аюулгүй (нууц үг сүлжээгээр огт явахгүй)
  боловч тусдаа crypto сан шаардана.
- **`serverless deploy` бүрд "Invalid configuration: provider.runtime" анхааруулга гарна.** Serverless v3-ийн
  дотоод schema `nodejs22.x`-г хараахан мэддэггүй ч Lambda-д runtime зөв ажилладаг. Node 20 нь AWS SDK-ийн
  дэмжлэг дуусах (2027-01) хугацаатай тул 22-ыг сонгосон.
- **Token нь `localStorage`-д хадгалагдана.** XSS эрсдэлтэй. Production-д httpOnly cookie ба BFF илүү
  аюулгүй. Ойролцоогоор 1 цагийн ID token-ыг refresh token-оор шинэчилнэ.
- **WebSocket token нь query string-д.** Browser header тавьж чадахгүй тул. API Gateway-ийн access log-д
  URL бичигдэхээр тохируулбал token ил гарна (одоо access log идэвхгүй). Өөр арга нь `Sec-WebSocket-Protocol`.
- **Хэрэглэгч тус бүрийн rate limit, WAF байхгүй.** Зөвхөн stage-ийн throttle (25 хүсэлт/сек, burst 50) бий, тиймээс нэг хэрэглэгч бусдын квотыг идэж болно. WAF ба хэрэглэгч тус бүрийн квот хэрэгтэй.
- **Шүүлтүүр нь ачаалсан хуудсуудад л үйлчилнэ.** Статус бүрийн нийт тоо server талаас ирдэггүй.
- **Хүргэлт симуляци.** Бодит хүргэлтэд `deliver()` нь суваг тус бүрээр SES, SNS, FCM дуудаж, provider-ийн
  алдааг байнгын (4xx) ба түр зуурын (5xx, timeout) гэж ангилна.
- **Sweeper 5 минутын нарийвчлалтай**, `byStatus` индекс нь `PENDING` дээр нэг partition-д төвлөрнө
  (бага ачаалалд асуудалгүй, их ачаалалд shard нэмнэ).
- **Хяналт хэсэгчилсэн.** Alarm-ууд бий, харин dashboard, structured (JSON) лог, X-Ray tracing алга.
- **CI бий, автомат deploy байхгүй.** `.github/workflows/ci.yml` нь `tsc`, тест, frontend build-ийг ажиллуулна. Deploy гараар хийгдэнэ.
- **Frontend-д component тест байхгүй.** Логик (reducer, WebSocket, auth, API) тестлэгдсэн, UI-ийг гараар
  шалгасан.
