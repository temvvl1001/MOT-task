// SQS message-ийг dead-letter болгохоос өмнө хэдэн удаа хүргэх вэ. Нэг газар хадгална:
// serverless.yml үүнтэй ижил тоог дарааллын redrive policy болон энэ env хувьсагчид өгнө.
export const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 3);

// Worker Lambda 60 секундийн дараа timeout болдог. Энэ хугацаанаас удаан хөндөгдөөгүй PROCESSING мөрийг
// орхигдсон гэж үзэж, дахин claim хийж болно.
export const LEASE_MS = 120_000;

// Энэ хугацаанд хэн ч аваагүй PENDING мөр дараалалд хэзээ ч орогдоогүй байх магадлалтай.
export const STALE_PENDING_MS = Number(process.env.STALE_PENDING_MS ?? 120_000);

// Notification-ууд үүссэнээс хойш энэ хугацааны дараа DynamoDB-ийн TTL-ээр устна.
export const RETENTION_SECONDS = 90 * 24 * 60 * 60;

// Түр зуурын алдааны дараа SQS message-ийг дахин хүргэхээс өмнөх backoff: 5 с, 10 с, 20 с ... дээд хязгаартай.
export const retryDelaySeconds = (attempt: number) => Math.min(5 * 2 ** (attempt - 1), 300);
