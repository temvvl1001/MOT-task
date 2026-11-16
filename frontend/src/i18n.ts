import type { Channel, NotificationStatus } from './types';

// Хэрэглэгчийн уншдаг бүх текст эндээс гарна. API алдааг тогтвортой `code`-оор хариулдаг
// (мөн хөгжүүлэгчид зориулсан англи тайлбартай); хэрэглэгчид харагдах текстийг тэр кодоор сонгоно.
export const t = {
  title: 'Мэдэгдлийн хүсэлтүүд',

  connection: {
    open: 'шууд',
    connecting: 'холбогдож байна...',
    closed: 'салсан',
  },

  account: { signOut: 'Гарах' },

  auth: {
    signInTitle: 'Нэвтрэх',
    signUpTitle: 'Бүртгүүлэх',
    email: 'Имэйл',
    password: 'Нууц үг',
    passwordHint: 'Дор хаяж 8 тэмдэгт, үсэг болон тоо агуулсан байх ёстой.',
    wait: 'Түр хүлээнэ үү...',
    signIn: 'Нэвтрэх',
    signUp: 'Бүртгүүлэх',
    toSignUp: 'Бүртгэлгүй юу? Бүртгүүлэх',
    toSignIn: 'Бүртгэлтэй юу? Нэвтрэх',
    failed: 'Нэвтрэхэд алдаа гарлаа. Дахин оролдоно уу.',
    notRegistered: 'Энэ имэйлээр бүртгэл олдсонгүй. Бүртгүүлнэ үү.',
    wrongCredentials: 'Имэйл эсвэл нууц үг буруу байна.',
  },

  form: {
    recipient: 'Хүлээн авагч',
    // Хүлээн авагч ямар харагдах нь сувгаас хамаарна.
    recipientPlaceholder: {
      EMAIL: 'bold@gmail.com',
      SMS: '+97699112233',
      PUSH: 'төхөөрөмжийн ID',
    } satisfies Record<Channel, string>,
    hintBefore: 'Имэйл сувгаар туршиж үзэх:',
    hintFail: 'татгалзана',
    hintFlaky: 'дахин оролдоод хүргэнэ',
    hintOutage: 'дахин оролдоод бууж өгнө',
    channel: 'Суваг',
    message: 'Мессеж',
    send: 'Мэдэгдэл илгээх',
    sending: 'Илгээж байна...',
    sent: (recipient: string) => `${recipient} хаяг руу хүсэлт илгээгдлээ. Төлөв доор шинэчлэгдэнэ.`,
    delayed: (recipient: string) =>
      `${recipient} хаягийн хүсэлт хадгалагдлаа. Удахгүй дараалалд орно.`,
  },

  channels: { EMAIL: 'Имэйл', SMS: 'SMS', PUSH: 'Push' } satisfies Record<Channel, string>,

  status: {
    PENDING: 'Хүлээгдэж байна',
    PROCESSING: 'Боловсруулж байна',
    COMPLETED: 'Дууссан',
    FAILED: 'Амжилтгүй',
  } satisfies Record<NotificationStatus, string>,

  list: {
    title: 'Хүсэлтүүд',
    all: 'Бүгд',
    loading: 'Ачаалж байна...',
    empty: 'Хүсэлт одоогоор алга.',
    noneWithStatus: (label: string, hasMore: boolean) =>
      `"${label}" төлөвтэй хүсэлт${hasMore ? ' ачаалсан хүсэлтүүдийн дунд' : ''} алга.`,
    loadMore: 'Цааш үзэх',
    loadingMore: 'Ачаалж байна...',
    attempt: (n: number) => `${n}-р оролдлого`,
  },

  errors: {
    generic: 'Алдаа гарлаа. Дахин оролдоно уу.',
    network: 'Сүлжээний алдаа. Сервертэй холбогдож чадсангүй.',
    authNetwork: 'Сүлжээний алдаа. Нэвтрэх үйлчилгээтэй холбогдож чадсангүй.',
    pleaseSignIn: 'Нэвтэрнэ үү.',
    sessionExpired: 'Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.',
    // API алдааны хариуны `code` -> хэрэглэгчид харуулах текст
    codes: {
      invalid_body: 'Хүсэлтийн бүтэц буруу байна.',
      invalid_json: 'Хүсэлтийн бүтэц буруу байна.',
      recipient_required: 'Хүлээн авагчийг бөглөнө үү.',
      invalid_channel: 'Сувгаа зөв сонгоно уу.',
      invalid_recipient_email: 'Имэйл хаяг буруу байна (жишээ нь bold@gmail.com).',
      invalid_recipient_phone: 'Утасны дугаар буруу байна (жишээ нь +97699112233 эсвэл 99112233).',
      invalid_recipient_device: 'Төхөөрөмжийн ID 3-128 тэмдэгт байх ёстой бөгөөд хоосон зай агуулж болохгүй.',
      message_required: 'Мессежээ бичнэ үү.',
      message_too_long: 'Мессеж хэт урт байна (дээд тал нь 500 тэмдэгт).',
      invalid_idempotency_key: 'Хүсэлтийн давхардлаас хамгаалах түлхүүр буруу байна.',
      idempotency_key_reused: 'Энэ түлхүүрээр өөр агуулгатай хүсэлт аль хэдийн илгээгдсэн байна. Дахин оролдоно уу.',
      invalid_limit: 'Жагсаалтын хэмжээ буруу байна.',
      invalid_next_token: 'Жагсаалтыг дахин ачаална уу.',
      unauthorized: 'Нэвтрэх шаардлагатай.',
    } as Record<string, string>,
  },

  config: {
    missing: (names: string[]) =>
      `Тохиргоо дутуу байна: ${names.join(', ')}. .env.example файлыг .env болгон хуулж бөглөнө үү (README-г үз).`,
  },
};

// API алдааны кодын текст, эсвэл код frontend-д үл мэдэгдэх бол undefined.
export const errorText = (code: unknown): string | undefined =>
  typeof code === 'string' ? t.errors.codes[code] : undefined;
