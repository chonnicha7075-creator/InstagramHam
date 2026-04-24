# 📱 InstaChar — Instagram for your SillyTavern characters

**Characters auto-post to Instagram based on your roleplay scenes. Full-featured IG clone inside SillyTavern.**

หลังจากคุยกับตัวละครไปเรื่อยๆ พวกเขาจะเริ่มโพสต์รูปลง Instagram ตามฉาก — caption ตามนิสัย, รูปสร้างจาก AI, NPC ในฉากมาคอมเมนต์, user ก็โพสต์ DM ได้

---

## ✨ Features

- 📸 **Auto-post** ตัวละครโพสต์อัตโนมัติตามฉากใน RP
- 🎨 **AI-generated images** ฟรี ไม่ต้อง API key (Pollinations)
- 💬 **NPC comments** NPC ในฉากมาคอมเมนต์จริง (generate ด้วย LLM)
- 👤 **Character profiles** bio, follower count, grid ของโพสต์
- ❤️ **Like / Double-tap heart** ทำงานจริง
- ✉️ **Private DM** คุยกับตัวละครส่วนตัว (ไม่กระทบ main chat)
- 🖼️ **User posts** คุณโพสต์ได้ ตัวละคร react/comment อัตโนมัติ
- 🖱️ **Draggable FAB** ลากไอคอนไปวางไหนก็ได้
- 🇹🇭 **Thai-first** output เป็นภาษาไทย
- 💾 **Persistent** บันทึกทุกอย่างถาวร

---

## 🚀 Installation

### Option 1: Install via Extension Manager (Recommended)

1. เปิด SillyTavern
2. Extensions panel → **Install extension**
3. ใส่ URL:
   ```
   https://github.com/chonnicha7075-creator/Instachar
   ```
4. กด Save → ✅

### Option 2: Manual Install

1. Clone หรือ download zip
2. วางที่:
   ```
   SillyTavern/public/scripts/extensions/third-party/instachar/
   ```
3. Restart SillyTavern

---

## 🎮 Usage

หลังติดตั้งเสร็จ:

1. จะมี **📱 ไอคอนโทรศัพท์** (gradient สีชมพู-ม่วง) ลอยอยู่ขวาล่าง
2. **ลากได้** — วางไว้ไหนก็ได้ มันจะจำตำแหน่ง
3. **แตะเพื่อเปิด** app
4. คุยกับตัวละครปกติ — พวกเขาจะสุ่มโพสต์ตามฉาก
5. เลขแดงบน badge = มีโพสต์ใหม่

### Slash Command

- `/insta` — รีเซ็ตตำแหน่งไอคอน (ถ้าหาไม่เจอ)

### ถ้าไอคอนไม่โผล่

1. เปิด F12 Console → ดู log `[InstaChar]`
2. ถ้าเห็น `loaded ✓` แสดงว่าทำงาน — อาจจะโดนอะไรบัง ลองเปิด app ผ่าน console:
   ```js
   document.getElementById('ic-fab').style.zIndex = '999999'
   ```
3. ถ้าไม่เห็น log เลย → SillyTavern ไม่ได้โหลด extension ลอง toggle ใน Extensions panel

---

## ⚙️ Settings

เปิดแอป → แท็บ **Profile (👤)**:

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-post | ON | ตัวละครโพสต์อัตโนมัติ |
| ความถี่ | 35% | โอกาสโพสต์ต่อ 1 message |
| รีเซ็ตตำแหน่ง | — | ย้ายไอคอนกลับตำแหน่งเริ่ม |
| ลบข้อมูล | — | reset ทุกอย่าง |

---

## 🔧 Technical

- **Images**: [Pollinations AI](https://pollinations.ai) (ฟรี ไม่ต้อง auth)
- **LLM calls**: ใช้ `generateQuietPrompt()` ของ SillyTavern (ใช้ API เดียวกับ chat)
- **Storage**: `extension_settings.instachar` (auto-save)
- **Token cost**: ~200-500 tokens per auto-post (caption + comments)

### Cost Management

แต่ละโพสต์ใช้ token เพิ่ม ถ้ากลัวเปลือง:
- ลดความถี่เหลือ 20-25%
- ปิด Auto-post แล้วเปิดตอนที่ต้องการ

---

## 🚧 Roadmap

- [ ] Stories (24h auto-expire)
- [ ] Close Friends mode
- [ ] Suspicious activity (ตัวละครโกหกผ่านโพสต์)
- [ ] Multiple NPC individual IGs
- [ ] Notifications panel
- [ ] Share posts to chat as images
- [ ] Reels / video support

---

## 🐛 Troubleshooting

**ไอคอนไม่โผล่**
- F12 Console ดู `[InstaChar]` log
- ลอง `/insta` reset position
- Toggle extension off/on

**โพสต์ไม่ generate**
- เช็คว่า Auto-post เปิด
- ความถี่ 35% = ต้องคุยหลายเมสเซจก่อนโพสต์
- โมเดลบางตัว return JSON ไม่ดี → ลอง Claude / GPT-4 / Gemini 2.5

**รูปไม่โหลด**
- Pollinations อาจ rate limit → รอ 30 วิ
- รูปแรกใช้เวลา 10-20 วิในการ generate

**คอมเมนต์ว่าง**
- LLM อาจตอบ format ผิด → ลองโมเดลที่ follow instruction ดีกว่านี้

---

## 📄 License

MIT — ดูไฟล์ [LICENSE](LICENSE)

## 🙏 Credits

Built with [Claude](https://claude.ai) Opus 4.7  
Images by [Pollinations AI](https://pollinations.ai)

---

## 🤝 Contributing

Pull requests welcome! ฟีเจอร์ที่อยากเห็น:
- เพิ่ม custom image providers (SD, etc.)
- Multi-language support (ปัจจุบันไทย/อังกฤษ)
- Export feed เป็น HTML/image

---

**Having fun? ⭐ Star this repo!**
