import SwiftUI
import PhotosUI

// The Post tab, native: photos → category → details → price → location →
// contact → submit. Uploads start the moment photos are picked; the submit
// button explains exactly what's missing. Success pushes the fresh listing.
struct PostView: View {
    @State private var model = PostModel()
    @State private var picker: [PhotosPickerItem] = []
    @State private var successId: String?

    private struct Success: Identifiable {
        let id: String
    }
    @State private var success: Success?

    var body: some View {
        NavigationStack {
            Form {
                photosSection
                categorySection
                detailsSection
                priceSection
                locationSection
                contactSection
                submitSection
            }
            .scrollContentBackground(.hidden)
            .background(Tokens.canvas)
            .navigationTitle(L10n.tr("Post a listing", "Đăng tin"))
            .navigationBarTitleDisplayMode(.inline)
            .task { await model.start() }
            .onChange(of: model.createdId) {
                if let id = model.createdId {
                    success = Success(id: id)
                    model.createdId = nil
                }
            }
            .sheet(item: $success) { s in
                successSheet(s.id)
            }
        }
    }

    // ── photos ──
    private var photosSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    PhotosPicker(selection: $picker, maxSelectionCount: 8 - model.photos.count, matching: .images) {
                        VStack(spacing: 6) {
                            Image(systemName: "camera.fill").font(.system(size: 20))
                            Text(L10n.tr("Add", "Thêm")).font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(Tokens.brand)
                        .frame(width: 84, height: 84)
                        .background(Tokens.brandTint, in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
                    }
                    .onChange(of: picker) {
                        let items = picker
                        picker = []
                        Task { await model.add(items: items) }
                    }
                    ForEach(model.photos) { photo in
                        photoThumb(photo)
                    }
                }
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
            Text(L10n.tr("At least 3 photos from different angles.", "Ít nhất 3 ảnh chụp các góc khác nhau."))
                .font(.system(size: 12))
                .foregroundStyle(model.uploadedUrls.count >= 3 ? Tokens.sub : Tokens.brand)
        } header: {
            Text(L10n.tr("Photos", "Hình ảnh"))
        }
    }

    private func photoThumb(_ photo: PostModel.Photo) -> some View {
        ZStack(alignment: .topTrailing) {
            Image(uiImage: photo.image)
                .resizable()
                .scaledToFill()
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: Tokens.radiusCard))
                .opacity(photo.url == nil && !photo.failed ? 0.5 : 1)
            if photo.url == nil && !photo.failed {
                ProgressView().frame(width: 84, height: 84)
            }
            if photo.failed {
                Button {
                    Task { await model.retryUpload(photo.id) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .foregroundStyle(.white)
                        .frame(width: 84, height: 84)
                        .background(.black.opacity(0.45), in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
                }
            }
            Button {
                model.remove(photo.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 22, height: 22)
                    .background(.black.opacity(0.55), in: Circle())
            }
            .padding(4)
        }
    }

    // ── category ──
    private var categorySection: some View {
        Section(L10n.tr("Category", "Danh mục")) {
            Picker(L10n.tr("Category", "Danh mục"), selection: Binding(
                get: { model.category?.slug ?? "" },
                set: { slug in if let cat = Categories.bySlug(slug) { model.pickCategory(cat) } }
            )) {
                Text(L10n.tr("Choose…", "Chọn…")).tag("")
                ForEach(Categories.all) { cat in
                    Text(cat.name).tag(cat.slug)
                }
            }
            if !model.subs.isEmpty {
                Picker(L10n.tr("Subcategory", "Danh mục con"), selection: Binding(
                    get: { model.subcategory?.slug ?? "" },
                    set: { slug in model.subcategory = model.subs.first { $0.slug == slug } }
                )) {
                    Text(L10n.tr("Auto", "Tự chọn")).tag("")
                    ForEach(model.subs) { sub in
                        Text(sub.displayName).tag(sub.slug)
                    }
                }
            }
        }
    }

    // ── details ──
    private var detailsSection: some View {
        Section(L10n.tr("Details", "Chi tiết")) {
            TextField(L10n.tr("Title", "Tiêu đề"), text: $model.title)
            TextField(L10n.tr("Description (optional)", "Mô tả (không bắt buộc)"), text: $model.descriptionText, axis: .vertical)
                .lineLimit(3...8)
            Picker(L10n.tr("Condition", "Tình trạng"), selection: Binding(
                get: { model.condition ?? "" },
                set: { model.condition = $0.isEmpty ? nil : $0 }
            )) {
                Text(L10n.tr("Not set", "Chưa chọn")).tag("")
                ForEach(PostModel.conditions, id: \.slug) { c in
                    Text(L10n.tr(c.en, c.vi)).tag(c.slug)
                }
            }
        }
    }

    // ── price ──
    private var priceSection: some View {
        Section(L10n.tr("Price", "Giá")) {
            HStack {
                TextField("0", text: $model.priceText)
                    .keyboardType(.numberPad)
                Text("đ").foregroundStyle(Tokens.sub)
            }
            Toggle(L10n.tr("Open to offers", "Cho phép trả giá"), isOn: $model.negotiable)
        }
    }

    // ── location ──
    private var locationSection: some View {
        Section(L10n.tr("Location", "Khu vực")) {
            Picker(L10n.tr("Province", "Tỉnh / Thành"), selection: Binding(
                get: { model.province?.code ?? "" },
                set: { code in if let p = model.provinces.first(where: { $0.code == code }) { model.pickProvince(p) } }
            )) {
                Text(L10n.tr("Choose…", "Chọn…")).tag("")
                ForEach(model.provinces) { p in
                    Text(p.name).tag(p.code)
                }
            }
            if !model.wards.isEmpty {
                Picker(L10n.tr("Ward", "Phường / Xã"), selection: Binding(
                    get: { model.ward?.code ?? "" },
                    set: { code in model.ward = model.wards.first { $0.code == code } }
                )) {
                    Text(L10n.tr("All", "Tất cả")).tag("")
                    ForEach(model.wards) { w in
                        Text(w.name).tag(w.code)
                    }
                }
            }
        }
    }

    // ── contact ──
    private var contactSection: some View {
        Section {
            TextField(L10n.tr("Phone number", "Số điện thoại"), text: $model.contactPhone)
                .keyboardType(.phonePad)
        } header: {
            Text(L10n.tr("Contact", "Liên hệ"))
        } footer: {
            Text(L10n.tr("Buyers chat in-app; your number is only revealed after you reply.",
                         "Người mua nhắn tin trong ứng dụng; số của bạn chỉ hiện sau khi bạn trả lời."))
        }
    }

    // ── submit ──
    private var submitSection: some View {
        Section {
            Button {
                Task { await model.submit() }
            } label: {
                Group {
                    if model.submitting {
                        ProgressView().tint(.white)
                    } else {
                        Text(L10n.tr("Post listing", "Đăng tin"))
                    }
                }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(model.canSubmit ? Tokens.brand : Tokens.sub, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
            }
            .disabled(!model.canSubmit)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            if let err = model.errorMessage {
                Text(err)
                    .font(.system(size: 13))
                    .foregroundStyle(Tokens.danger)
            }
        }
    }

    private func successSheet(_ id: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 52))
                .foregroundStyle(.green)
            Text(L10n.tr("Your listing is live!", "Tin của bạn đã được đăng!"))
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Tokens.fg)
            Text(L10n.tr("Buyers can see it right away. You'll be notified about messages and offers.",
                         "Người mua có thể xem ngay. Bạn sẽ nhận thông báo khi có tin nhắn hoặc trả giá."))
                .font(.system(size: 14))
                .foregroundStyle(Tokens.sub)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            Button {
                success = nil
            } label: {
                Text(L10n.tr("Done", "Xong"))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 40)
                    .frame(height: 48)
                    .background(Tokens.brand, in: RoundedRectangle(cornerRadius: Tokens.radiusControl))
            }
        }
        .padding(24)
        .presentationDetents([.height(320)])
    }
}
