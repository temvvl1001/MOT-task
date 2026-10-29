# Notification Request System

## Ажиллах зарчим

```
Browser ──POST /notifications──► createNotification λ
                                    1. validate → DynamoDB-д хадгална (PENDING)
                                    2. SQS-д { id } илгээнэ
                                          ▼
         DynamoDB ◄── 4. status өөрчилнө ── worker λ ◄── SQS ──(3 удаа алдвал)──► DLQ
                                          │
                       5. status өөрчлөгдөх бүрт WebSocket-ээр push
                                          ▼
                                       Browser
```

```
PENDING ──► PROCESSING ──► COMPLETED
                      └──► FAILED
```

Хүргэлт нь **симуляци** (`backend/src/lib/deliver.ts`): 1–3 секунд хүлээгээд амжилттай болгоно.
`fail` гэсэн үгтэй хүлээн авагч  үргэлж `FAILED` болно, ингэснээр
алдааны тохиолдлыг демо хийж болно. Бодит и-мэйл/SMS илгээхгүй.

## WebSocket-ийн шийдвэр

- **Connection ID хадгалах:** `$connect` үед `connectionId`-г DynamoDB `Connections` хүснэгтэд
  хадгалж, `$disconnect` үед устгана. Lambda stateless тул холбогдсон хэрэглэгчдийг shared store-д
  хадгалах шаардлагатай.
- **Client-д хүргэх:** Worker status өөрчлөх бүрт `Connections`-ийг уншиж, холболт бүрт API Gateway
  Management API-ийн `PostToConnection`-оор message илгээнэ (`backend/src/lib/broadcast.ts`).
- **Салсан холболт:** Сүлжээ тасрах, компьютер унтрах үед `$disconnect` ирэхгүй байж болно. Тэр үед
  `PostToConnection` нь `410 Gone` буцааж, бид холболтыг тэр дор нь устгана. Нэмэлтээр
  `expiresAt` (3 цагийн дараа) гэсэн **DynamoDB TTL** тохируулсан. API Gateway холболтыг дээд тал нь
  2 цагт таслах тул амьд холболтыг TTL устгахгүй.
- **Алдаа тусгаарлах:** `Promise.allSettled` ашигласан тул нэг client-ийн алдаа бусдад нөлөөлөхгүй,
  push-ийн алдаа worker-ийг унагахгүй.
- **Дахин холбогдох:** Browser нь exponential backoff-оор (1с → 15с) автоматаар дахин холбогдож,
  холбогдсоны дараа жагсаалтыг дахин татаж алдсан update-ээ нөхнө.
- **Дараалал:** Push нь `POST`-ийн хариунаас түрүүлж ирж болно. UI нь `updatedAt` нь шинэ хувилбарыг л
  хадгална.

## API ба message бүтэц

**Notification** (DynamoDB, API хариу, WebSocket message гурвуулаа ижил хэлбэртэй):

```json
{
  "id": "5f0c9a52-6c1d-4d3e-9b1a-2d6f1c3e8a77",
  "recipient": "bold@example.com",
  "channel": "EMAIL",
  "message": "Hello",
  "status": "COMPLETED",
  "result": "Delivered via EMAIL to bold@example.com",
  "createdAt": "2026-10-28T08:34:03.120Z",
  "updatedAt": "2026-10-28T08:34:06.431Z"
}
```

`channel`: `EMAIL | SMS | PUSH`.
 `status`: `PENDING | PROCESSING | COMPLETED | FAILED`.

**`POST /notifications`**

```bash
curl -X POST "$API_URL/notifications" \
  -H "Content-Type: application/json" \
  -d '{"recipient":"bold@example.com","channel":"EMAIL","message":"Hello"}'
```

Амжилттай бол `201` ба `status: "PENDING"` бүхий notification буцна. Алдаа:

| Код | Хариу | Үед |
|---|---|---|
| `400` | `{ "error": "Invalid JSON" }` | Body JSON биш |
| `400` | `{ "error": "recipient is required" }` | `recipient`/`message` хоосон |
| `400` | `{ "error": "channel must be one of EMAIL, SMS, PUSH" }` | Буруу channel |
| `400` | `{ "error": "message must be 500 characters or less" }` | Message урт |
| `500` | `{ "error": "Failed to queue notification" }` | SQS-д илгээж чадсангүй (item `FAILED` болно) |

**`GET /notifications`** нь notification-уудын жагсаалтыг буцаана.


## Гол шийдвэрүүд

| Шийдвэр | Шалтгаан |
|---|---|
| **Эхлээд DynamoDB, дараа нь SQS** | Worker бичлэгийг үргэлж олно. SQS алдвал item `FAILED` болж `500` буцна, `PENDING`-д  гацахгүй |
| **Атомик status шилжилт** | SQS нэг message-ийг хоёр удаа өгч болно. Worker нөхцөлтэй `UpdateItem`-ээр (`status = PENDING`) claim хийдэг тул давхар боловсруулахгүй |
| **Lease (60 сек)** | Worker дундаа унавал `PROCESSING`-д гацсан item-ийг 60 секундийн дараа дахин авч болно |
| **DLQ (`maxReceiveCount: 3`)** | Системийн алдаатай message 3 удаа дахин оролдоод DLQ руу орно, алга болохгүй |
| **Бизнес ба системийн алдааг ялгасан** | Татгалзсан хүргэлтийг `FAILED` гэж бүртгэнэ (дахин оролдох утгагүй). Гэнэтийн алдааг дахин шидэж SQS-д retry хийлгэнэ |
| **Backend дахин шалгана** | Frontend-ийн шалгалт хэрэглэгчид туслах, жинхэнэ хамгаалалт нь `lib/validate.ts` |
| **HTTP API (REST биш)** | Хямд, энгийн, CORS нэг мөр |
| **`PAY_PER_REQUEST`** | Жижиг ачаалалд capacity төлөвлөх шаардлагагүй |
| **Vanilla TypeScript frontend** | UI нь нэг форм, нэг жагсаалт. Framework нэмэлт ашиггүй |


## Ажиллуулах

Шаардлага: Node.js 20+, AWS account (`aws configure`), `npm install -g serverless@3`.

**Backend**

```bash
cd backend
npm install
npm test
serverless deploy
```

Region нь `backend/serverless.yml` дахь `provider.region`. Deploy дуусахад дараах endpoint-ууд гарна:

```
wss://<ws-api-id>.execute-api.<region>.amazonaws.com/dev
POST - https://<http-api-id>.execute-api.<region>.amazonaws.com/notifications
GET  - https://<http-api-id>.execute-api.<region>.amazonaws.com/notifications
```

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env     # deploy-оос гарсан хоёр URL-ийг бөглөнө
npm run dev              # http://localhost:5173
```

```
VITE_API_URL=https://<http-api-id>.execute-api.<region>.amazonaws.com
VITE_WS_URL=wss://<ws-api-id>.execute-api.<region>.amazonaws.com/dev
```

**Туршиж үзэх**

- `bold@example.com` илгээвэл `PENDING → PROCESSING → COMPLETED` өөрөө өөрчлөгдөнө.
- `fail@example.com` илгээвэл `FAILED` болно.
- Хоосон `recipient` илгээвэл backend-ийн алдааны мессеж гарна.
- Хоёр tab нээвэл нэг илгээлтээр хоёулаа шинэчлэгдэнэ.

**Устгах:** `cd backend && serverless remove`

## Тест

`cd backend && npm test`: 40 unit тест. AWS-ийн client-уудыг mock хийсэн тул credential хэрэггүй.

| Файл | Юуг шалгадаг |
|---|---|
| `validate.test.ts` | Validate, хязгаарын утга (500 ба 501 тэмдэгт), буруу төрөл |
| `createNotification.test.ts` | Буруу JSON/өгөгдөл AWS-д хүрэхгүй, `PENDING` хадгалж зөвхөн id-г илгээнэ, DynamoDB өмнө нь SQS дараа нь, SQS алдвал `FAILED` ба `500` |
| `worker.test.ts` | Амжилттай/амжилтгүй хүргэлт, атомик claim, өөр worker эзэмшсэн item-ийг алгасах, гэнэтийн алдааг дахин шидэх |
| `broadcast.test.ts` | Холболт бүрт нэг message, `410` үед холболт устах, бусад алдаа хоёр дахь push-ийг зогсоохгүй |
| `wsConnect.test.ts` | `connectionId` ба WebSocket-ийн хугацаанаас урт TTL хадгална |

Mock хийсэн DynamoDB нөхцөлт илэрхийллийг өөрөө ажиллуулдаггүй. Тэдгээрийг deploy хийж бодитоор
ашиглан баталгаажуулсан.
