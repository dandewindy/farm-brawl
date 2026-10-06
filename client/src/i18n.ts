// UI texts. Vietnamese first; English arrives in phase 5 with a language picker.
const vi = {
  slogan: 'Húc đối thủ vào hàng rào điện. Ăn thật nhiều. Trở thành con vật nặng ký nhất nông trại!',
  namePh: 'Tên của bạn',
  pick: 'Chọn con vật',
  play: 'VÀO NÔNG TRẠI',
  how1: 'Di chuột để chạy, click để lao tới húc',
  how1_touch: 'Kéo bên trái màn hình để chạy, bấm nút HÚC để lao tới',
  how2: 'Giữ chuột (hoặc phím Space) để tích lực, thả ra để húc thật mạnh, xuyên qua cả đám đông',
  how3: 'Đẩy đối thủ vào hàng rào điện để hạ gục và lấy kg của nó',
  how4: 'Bùn làm chậm (trừ Heo), ao làm chậm (trừ Vịt), kiện rơm thì không xuyên qua được',
  offlineNote: 'Bản thử nghiệm giai đoạn 1: chơi với bot ngay trong trình duyệt.',
  defaultName: 'Nông dân',
  lbTitle: 'Nặng ký nhất',
  dash: 'HÚC',
  rank: 'Hạng {r}/{n}',
  kos: '{k} hạ gục',
  ramReady: 'SẴN SÀNG HÚC',
  ramCd: 'ĐANG HỒI',
  ramCharge: 'TÍCH LỰC {p}%',
  stKg: 'kg cao nhất',
  stKo: 'hạ gục',
  stTime: 'sống sót',
  again: 'CHƠI LẠI',
  change: 'Đổi con vật',
  t_fence: 'GIẬT ĐIỆN!',
  fenceBy: '{killer} đã húc bạn vào hàng rào điện.',
  fenceSelf: 'Bạn tự chạy vào hàng rào điện.',
  recNew: 'Kỷ lục mới! (cũ: {old} kg)',
  recFirst: 'Kỷ lục đầu tiên của bạn!',
  needMore: 'Kỷ lục: {best} kg. Còn thiếu {n} kg nữa thôi!',
  best: 'Kỷ lục: {kg} kg',
  youKO: 'Bạn đã hạ gục {name}!',
  spoils: '+{kg} kg chiến lợi phẩm',
  streak2: 'Hai mạng liên tiếp!',
  streak3: 'Ba mạng! Không ai cản nổi!',
  streak5: 'Năm mạng! Hung thần nông trại!',
  c_fence: '⚡ hàng rào',
  milestone: 'Đã đạt {kg} kg!',
  newBest: 'Vượt kỷ lục cũ!',
  welcome: 'Chào mừng tới nông trại!',
  welcomeSub: 'Ăn để lớn, húc để thắng',
  capYou: 'ĐANG CHIẾM BỤC - {p}%',
  capOther: '{name} ĐANG CHIẾM - {p}%',
  contested: 'TRANH CHẤP BỤC!',
  kingYou: 'BẠN ĐANG LÀ VUA NÔNG TRẠI 👑',
  kingOther: '{name} LÀ VUA NÔNG TRẠI 👑',
  sp_chicken: 'Gà: lao nhanh hơn 12%, nhưng nhẹ ký nên dễ bị đẩy văng.',
  sp_sheep: 'Cừu: bộ lông dày giúp chịu đòn tốt hơn.',
  sp_horse: 'Ngựa: chạy nhanh nhất nông trại.',
  sp_cow: 'Bò: nặng nề và lì đòn nhất, nhưng hơi chậm.',
  sp_duck: 'Vịt: bơi nhanh dưới ao, nhưng đi bộ chậm.',
  sp_pig: 'Heo: lội bùn không hề bị chậm.',
} as const;

export type TextKey = keyof typeof vi;

export function t(key: TextKey | string, vars: Record<string, string | number> = {}): string {
  const s = (vi as Record<string, string>)[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** fill every [data-i18n] element */
export function applyTexts(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n!);
}
