// Bộ câu hỏi lọc ứng viên (congsu.thucduonglanh.vn). Phần sau "export default" là JSON thuần: build_congsu.py đọc để hiện câu hỏi, apply.js đọc để chấm điểm.
export default {
  "_note": "Bộ câu hỏi lọc ứng viên trang tuyển dụng congsu.thucduonglanh.vn. build_congsu.py đọc để hiện câu hỏi, api/src/apply.js đọc để chấm điểm. Số cuối mỗi lựa chọn = điểm (tình huống 0–3, điều kiện 0–2). Sửa xong phải đăng cả trang tuyển dụng lẫn máy chủ api.",
  "weights": { "read": 15, "cases": 50, "self": 25, "must": 10 },
  "read": [
    { "id": "r1", "q": "Thực Dưỡng Lành mong giúp bao nhiêu người Việt sống khỏe từ Thân đến Tâm?",
      "opts": [["a", "1 triệu người"], ["b", "10 triệu người"], ["c", "100 triệu người"]], "ok": "b" },
    { "id": "r2", "q": "Ba gốc rễ trong cây giá trị của chúng tôi là gì?",
      "opts": [["a", "Nhanh – Rẻ – Nhiều"], ["b", "Đạo đức – Trí tuệ – Nghị lực"], ["c", "Thân – Tâm – Trí"]], "ok": "c" }
  ],
  "cases": [
    { "id": "s1", "q": "Sắp tới hạn nộp một việc quan trọng, bạn nhận ra mình không kịp. Bạn sẽ:",
      "opts": [["a", "Cố làm, đến hạn được tới đâu nộp tới đó", 1], ["b", "Báo ngay cho quản lý: đang ở đâu, cần thêm bao lâu, cần hỗ trợ gì", 3], ["c", "Đến hạn rồi giải thích lý do", 0], ["d", "Nhờ đồng nghiệp làm hộ một phần, không cần báo ai", 1]] },
    { "id": "s2", "q": "Bạn thấy một đồng nghiệp thân ghi sai số liệu trong báo cáo sắp gửi Ban điều hành. Bạn sẽ:",
      "opts": [["a", "Im lặng, vì không phải việc của mình", 0], ["b", "Báo ngay với cấp trên để cấp trên xử lý", 1], ["c", "Nói riêng với bạn ấy, cùng kiểm tra và sửa trước khi gửi", 3], ["d", "Kể với vài đồng nghiệp khác để mọi người cùng biết", 0]] },
    { "id": "s3", "q": "Một khách hỏi: “Uống sản phẩm này có khỏi bệnh tiểu đường không?”. Bạn trả lời:",
      "opts": [["a", "Có, nhiều người dùng đã khỏi rồi", 0], ["b", "Em chưa chắc, anh chị cứ dùng thử xem sao", 0], ["c", "Đây là thực phẩm, không phải thuốc, không chữa được bệnh; có thể giúp bữa ăn lành hơn và anh chị vẫn theo điều trị của bác sĩ", 3], ["d", "Để em hỏi lại chuyên gia rồi trả lời anh chị sau", 2]] },
    { "id": "s4", "q": "Quản lý giao một việc bạn chưa từng làm và chưa biết cách làm. Bạn sẽ:",
      "opts": [["a", "Từ chối vì không đúng chuyên môn của mình", 0], ["b", "Nhận việc rồi chờ được hướng dẫn chi tiết", 1], ["c", "Nhận việc nhưng để đó, làm việc quen trước", 0], ["d", "Nhận việc, tự tìm hiểu (hỏi người đi trước, hỏi AI) và báo lại kế hoạch ngay trong ngày", 3]] }
  ],
  "self": [
    { "id": "f1", "q": "Tôi thấy việc là làm, không đợi ai nhắc." },
    { "id": "f2", "q": "Khi sai, tôi nhận lỗi trước rồi mới giải thích." },
    { "id": "f3", "q": "Tôi muốn được góp ý thẳng thắn để tiến bộ, kể cả khi nghe không dễ chịu." },
    { "id": "f4", "q": "Tuần nào tôi cũng dành thời gian tự học một điều mới." },
    { "id": "f5", "q": "Tôi thật lòng quan tâm tới ăn uống lành mạnh, cho mình và người thân." },
    { "id": "f6", "q": "Tôi muốn gắn bó lâu dài (từ 2 năm trở lên) với một nơi có cùng giá trị." }
  ],
  "must": [
    { "id": "k1", "q": "Bạn làm việc được toàn thời gian tại văn phòng Vinhomes Ocean Park (Gia Lâm), từ Thứ 2 đến Thứ 7?",
      "opts": [["a", "Được", 2], ["b", "Được, nhưng cần trao đổi thêm", 1], ["c", "Không được", 0]], "flag": "Chưa làm được toàn thời gian tại văn phòng" },
    { "id": "k2", "q": "Bạn có muốn tham gia các hoạt động văn hóa chung (ăn chay cùng đội ngày mùng 1 và rằm, thiện nguyện, trà đàm)?",
      "opts": [["a", "Có, tôi thích", 2], ["b", "Tôi sẵn sàng thử", 1], ["c", "Tôi không muốn", 0]], "flag": "Không muốn tham gia hoạt động văn hóa chung" }
  ]
};
