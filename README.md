Архитектурын диаграм ба урсгал: Browser → API → Lambda → DynamoDB → SQS → Worker → WebSocket → Browser
WebSocket-ийн шийдвэр
Connection ID-г  DynamoDB Connections хүснэгтэд хадгалсан
worker PostToConnection-оор бүх холбогдсон client руу хүргэдэг:
Салсан client: 410 Gone ирвэл устгана
Browser талд автомат дахин холбогдох
Data бүтэц: Notification, DynamoDB key (id), SQS message {id}, WebSocket message {type, notification}
API endpoint ба request/response: POST ба GET /notifications, 201/400/500
Lifecycle ба асинхрон урсгал
DynamoDB эхлээд, дараа нь SQS; атомик status; DLQ; бизнес болон системийн алдааг ялгах технекийн шийвдэрийг гаргасн
deploy, .env, frontend эхлүүлнэ
юуг, яагаад тестэлсэн (validate, worker)
Scan, нэвтрэлтгүй, симуляци хийсэн хүргэлт эдгээр зүйлс одоогоор хийгдээгүй 