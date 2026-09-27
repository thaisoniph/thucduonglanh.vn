from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "bo-cong-thuong"
FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

COMPANY = "CÔNG TY TNHH TẬP ĐOÀN VITAGREEN NUTRITION"
ADDRESS = "HA10-SP8A-15, Đường Hải Âu 8A, KĐT Vinhomes Ocean Park, Gia Lâm, TP. Hà Nội"
HOTLINE = "0896 869 333"
EMAIL = "vitagreennutrition@gmail.com"
DOMAIN = "thucduonglanh.vn"


def setup_styles():
    pdfmetrics.registerFont(TTFont("ArialVN", FONT))
    pdfmetrics.registerFont(TTFont("ArialVNBold", FONT_BOLD))
    styles = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("doc-title", parent=styles["Title"], fontName="ArialVNBold", fontSize=17, leading=22, alignment=TA_CENTER, textColor=colors.HexColor("#176a3a"), spaceAfter=8),
        "subtitle": ParagraphStyle("doc-subtitle", parent=styles["Normal"], fontName="ArialVN", fontSize=9, leading=13, alignment=TA_CENTER, textColor=colors.HexColor("#5f665f"), spaceAfter=10),
        "h2": ParagraphStyle("doc-h2", parent=styles["Heading2"], fontName="ArialVNBold", fontSize=12, leading=16, textColor=colors.HexColor("#176a3a"), spaceBefore=10, spaceAfter=5),
        "body": ParagraphStyle("doc-body", parent=styles["BodyText"], fontName="ArialVN", fontSize=10.5, leading=16, spaceAfter=6),
        "footer": ParagraphStyle("doc-footer", parent=styles["Normal"], fontName="ArialVN", fontSize=8.5, leading=12, alignment=TA_CENTER, textColor=colors.HexColor("#5f665f")),
    }


def p(text, style):
    return Paragraph(escape(text).replace("\n", "<br/>"), style)


def make_pdf(filename, title, sections):
    s = setup_styles()
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / filename

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#d8e4da"))
        canvas.line(20 * mm, 16 * mm, 190 * mm, 16 * mm)
        canvas.setFont("ArialVN", 8)
        canvas.setFillColor(colors.HexColor("#5f665f"))
        canvas.drawCentredString(105 * mm, 10 * mm, f"{COMPANY} | {DOMAIN} | Trang {doc.page}")
        canvas.restoreState()

    story = [p(title, s["title"]), p(f"Áp dụng tại {DOMAIN} · Chủ sở hữu: {COMPANY}", s["subtitle"]), HRFlowable(width="100%", thickness=0.8, color=colors.HexColor("#cde0d1")), Spacer(1, 4)]
    for heading, paragraphs in sections:
        story.append(p(heading, s["h2"]))
        for paragraph in paragraphs:
            story.append(p(paragraph, s["body"]))
    story.extend([Spacer(1, 8), HRFlowable(width="100%", thickness=0.8, color=colors.HexColor("#cde0d1")), Spacer(1, 4), p(f"Liên hệ: {HOTLINE} · {EMAIL} · {ADDRESS}", s["footer"])])
    SimpleDocTemplate(str(dest), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=24 * mm, title=title, author=COMPANY).build(story, onFirstPage=footer, onLaterPages=footer)


def main():
    make_pdf("01-chinh-sach-bao-mat.pdf", "CHÍNH SÁCH BẢO MẬT THÔNG TIN", [
        ("1. Mục đích thu thập thông tin", ["Thực Dưỡng Lành thu thập họ tên, số điện thoại, email, địa chỉ nhận hàng nhằm xử lý đơn hàng, giao hàng, chăm sóc khách hàng và thông báo chương trình ưu đãi khi quý khách đồng ý."]),
        ("2. Phạm vi sử dụng", ["Thông tin chỉ được sử dụng nội bộ và chia sẻ cho đơn vị vận chuyển trong phạm vi cần thiết để giao hàng. Chúng tôi không bán, trao đổi hay cho thuê thông tin cá nhân của khách hàng cho bên thứ ba."]),
        ("3. Thời gian lưu trữ", ["Thông tin được lưu trữ cho đến khi quý khách yêu cầu hủy bỏ hoặc theo quy định của pháp luật."]),
        ("4. Quyền của khách hàng", [f"Quý khách có quyền yêu cầu kiểm tra, cập nhật, điều chỉnh hoặc xóa thông tin cá nhân bằng cách liên hệ {EMAIL} hoặc hotline {HOTLINE}."]),
    ])
    make_pdf("02-tiep-nhan-va-giai-quyet-khieu-nai.pdf", "QUY TRÌNH TIẾP NHẬN VÀ GIẢI QUYẾT KHIẾU NẠI", [
        ("Bước 1. Tiếp nhận", [f"Quý khách gửi phản ánh qua hotline {HOTLINE}, Zalo, email {EMAIL} hoặc biểu mẫu liên hệ trên website, kèm mã đơn hàng và hình ảnh/video nếu có."]),
        ("Bước 2. Xác minh", ["Bộ phận chăm sóc khách hàng liên hệ lại trong vòng 24 giờ làm việc để xác minh thông tin."]),
        ("Bước 3. Giải quyết", ["Chúng tôi đưa ra phương án xử lý như đổi sản phẩm, hoàn tiền hoặc bồi hoàn trong vòng 3–5 ngày làm việc kể từ khi xác minh xong."]),
        ("Bước 4. Phản hồi", ["Kết quả được thông báo tới quý khách. Trường hợp không đạt được thỏa thuận, các bên có thể yêu cầu cơ quan có thẩm quyền giải quyết theo quy định pháp luật."]),
    ])
    make_pdf("03-chinh-sach-gia-va-dieu-kien-cung-cap.pdf", "CHÍNH SÁCH GIÁ VÀ ĐIỀU KIỆN CUNG CẤP HÀNG HÓA", [
        ("Giá niêm yết", ["Giá bán của từng sản phẩm được niêm yết bằng đồng Việt Nam (VND) trên trang sản phẩm và được hiển thị lại trong giỏ hàng, bước thanh toán trước khi quý khách xác nhận đặt hàng.", "Giá niêm yết trên website đã bao gồm thuế giá trị gia tăng (VAT)."]),
        ("Phí giao hàng", ["Đơn hàng dưới 300.000đ áp dụng phí vận chuyển 30.000đ. Đơn hàng từ 300.000đ được miễn phí vận chuyển toàn quốc. Phí giao hàng được hiển thị rõ tại bước thanh toán."]),
        ("Thay đổi giá và ưu đãi", ["Khi có chương trình ưu đãi, mức giá và điều kiện áp dụng sẽ được công bố trực tiếp trên website. Giá và ưu đãi hiển thị tại thời điểm quý khách xác nhận đơn hàng là căn cứ áp dụng cho đơn hàng đó."]),
        ("Phạm vi và điều kiện cung cấp", ["Thực Dưỡng Lành cung cấp các sản phẩm dinh dưỡng từ hạt, trà thảo mộc, gia vị và thực phẩm thuần chay trên phạm vi Việt Nam.", "Quý khách cần cung cấp chính xác họ tên, số điện thoại và địa chỉ nhận hàng để xác nhận, giao hàng và hỗ trợ sau bán hàng. Sản phẩm được cung cấp theo tình trạng còn hàng thực tế. Nếu sản phẩm tạm hết hàng hoặc cần điều chỉnh thông tin đơn hàng, chúng tôi sẽ liên hệ với quý khách qua số điện thoại đã cung cấp để thống nhất phương án xử lý."]),
    ])
    make_pdf("04-chinh-sach-thanh-toan.pdf", "CHÍNH SÁCH THANH TOÁN", [
        ("1. Thanh toán khi nhận hàng (COD)", ["Quý khách thanh toán tiền mặt cho nhân viên giao hàng sau khi kiểm tra hàng hóa."]),
        ("2. Chuyển khoản ngân hàng", ["Quý khách chuyển khoản theo thông tin tài khoản hiển thị ở bước thanh toán, nội dung chuyển khoản ghi mã đơn hàng. Đơn hàng sẽ được xử lý ngay sau khi chúng tôi nhận được thanh toán."]),
        ("Lưu ý an toàn", ["Thực Dưỡng Lành không yêu cầu quý khách cung cấp mật khẩu, mã OTP hay thông tin thẻ dưới bất kỳ hình thức nào."]),
    ])
    make_pdf("05-giao-hang-doi-tra-va-hoan-tien.pdf", "CHÍNH SÁCH GIAO HÀNG, ĐỔI TRẢ VÀ HOÀN TIỀN", [
        ("Phạm vi và thời gian giao hàng", ["Thực Dưỡng Lành giao hàng trên toàn quốc thông qua các đơn vị vận chuyển uy tín. Nội thành Hà Nội dự kiến 1–2 ngày làm việc; các tỉnh thành khác dự kiến 2–5 ngày làm việc tùy khu vực. Thời gian có thể thay đổi trong dịp lễ, Tết hoặc do điều kiện thời tiết, dịch bệnh."]),
        ("Theo dõi đơn hàng", [f"Sau khi đơn hàng được gửi đi, chúng tôi sẽ cung cấp mã vận đơn để quý khách theo dõi. Mọi thắc mắc vui lòng liên hệ {HOTLINE}."]),
        ("Trường hợp được đổi trả", ["Sản phẩm bị lỗi do nhà sản xuất, hư hỏng do vận chuyển; giao sai sản phẩm hoặc sai số lượng; sản phẩm hết hạn sử dụng tại thời điểm nhận hàng."]),
        ("Điều kiện và chi phí", ["Quý khách thông báo trong vòng 7 ngày kể từ ngày nhận hàng; sản phẩm còn nguyên tem niêm phong, trừ trường hợp lỗi chất lượng bên trong; có hình ảnh/video chứng minh tình trạng. Thực Dưỡng Lành chịu chi phí vận chuyển đổi trả nếu lỗi thuộc về chúng tôi."]),
        ("Hoàn tiền", ["Trường hợp đơn hàng đủ điều kiện hoàn tiền sau khi được xác minh, Thực Dưỡng Lành hoàn tiền bằng chuyển khoản ngân hàng trong vòng 7 ngày làm việc. Quý khách cung cấp chính xác thông tin tài khoản nhận tiền để quá trình hoàn tiền được thực hiện thuận lợi."]),
        ("Không áp dụng đổi trả", ["Không áp dụng với sản phẩm đã qua sử dụng, hư hỏng do bảo quản không đúng hướng dẫn hoặc đổi trả vì lý do cá nhân không thuộc các trường hợp nêu trên."]),
    ])


if __name__ == "__main__":
    main()
