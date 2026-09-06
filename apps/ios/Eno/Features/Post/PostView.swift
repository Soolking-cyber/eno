import SwiftUI
import EnoUI
import PhotosUI
import CoreTransferable
import UniformTypeIdentifiers
import UIKit

// The Post tab, native: photos → category → details → price → location →
// contact → submit. Uploads start the moment photos are picked; the submit
// button explains exactly what's missing. Success pushes the fresh listing.
struct PostView: View {
    @State private var model = PostModel()
    @State private var picker: [PhotosPickerItem] = []
    @State private var videoPick: PhotosPickerItem?
    // Single presentation source for the camera. Two stacked .fullScreenCover on
    // one view node fought over the presentation slot, so the first (Take Photo)
    // opened then tore itself down on the first tap (worked on the second). One
    // .fullScreenCover(item:) on the Form — separate node from the .photosPickers —
    // fixes it. Root cause + fix confirmed by codex + Gemini.
    enum CameraRoute: Identifiable { case photo, video; var id: Self { self } }
    @State private var cameraRoute: CameraRoute?
    @State private var showLibrary = false
    @State private var showVideoLibrary = false
    @State private var successId: String?

    // Copies a picked movie out of the Photos sandbox into a temp file we can read.
    private struct MovieFile: Transferable {
        let url: URL
        static var transferRepresentation: some TransferRepresentation {
            FileRepresentation(contentType: .movie) { SentTransferredFile($0.url) } importing: { received in
                let copy = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString + "." + received.file.pathExtension)
                try? FileManager.default.removeItem(at: copy)
                try FileManager.default.copyItem(at: received.file, to: copy)
                return MovieFile(url: copy)
            }
        }
    }

    private struct Success: Identifiable {
        let id: String
    }
    @State private var success: Success?
    // Set on a Post tap while the form is incomplete → turns on the red highlights.
    @State private var attemptedSubmit = false
    /// The publish-time sign-in gate — see the note in submitSection.
    @State private var signInSheet = false
    private var auth: AuthModel { AuthModel.shared }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            Form {
                photosSection.id(PostModel.FormField.photos).listRowBackground(rowBG(.photos))
                categorySection.id(PostModel.FormField.category).listRowBackground(rowBG(.category))
                detailsSection.id(PostModel.FormField.details).listRowBackground(rowBG(.details))
                specificsSection.id(PostModel.FormField.specifics).listRowBackground(rowBG(.specifics))
                priceSection.id(PostModel.FormField.price).listRowBackground(rowBG(.price))
                locationSection
                contactSection.id(PostModel.FormField.contact).listRowBackground(rowBG(.contact))
                submitSection(proxy)
            }
            .scrollContentBackground(.hidden)
            .background(Tokens.canvas)
            // ⚠️ PUBLISH STRAIGHT AFTER SIGNING IN. Making the seller find and tap Post a second time
            // after a modal they did not ask for is where drafts get abandoned; the whole point of
            // gating at the end is that the work is already done.
            .sheet(isPresented: $signInSheet) { WebSheet(path: "/signin") }
            .onChange(of: auth.isSignedIn) {
                guard auth.isSignedIn, signInSheet else { return }
                signInSheet = false
                if model.canSubmit { Task { await model.submit() } }
            }
            .scrollDismissesKeyboard(.interactively) // drag down to dismiss
            .hideKeyboardOnTapAnywhere()              // tap outside a field to dismiss
            .navigationTitle(L10n.tr("Post a listing", "Đăng tin"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // Post is a tab root (nothing pushed it), so it has no automatic
                // back button. Add an explicit leading control to leave the form
                // back to browsing — parity with the arrow every pushed page has.
                ToolbarItem(placement: .topBarLeading) {
                    Button { DeepLinkRouter.shared.selectedTab = 0 } label: {
                        EnoIcon("back")
                            .fontWeight(.semibold)
                            .foregroundStyle(Tokens.brand)
                    }
                }
                // Explicit dismiss above the keyboard (the numeric price/phone pads
                // have no return key to hide it).
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button(L10n.tr("Done", "Xong")) { KeyboardDismissGesture.resign() }
                        .foregroundStyle(Tokens.brand)
                }
            }
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
            // ONE camera presentation source (photo|video), attached to the Form —
            // a different view node than the .photosPickers on photosSection — so
            // no view has two stacked covers. This fixes Take Photo auto-closing on
            // the first tap (codex + Gemini: stacked-presenter race).
            .fullScreenCover(item: $cameraRoute) { route in
                CameraPicker(
                    isPresented: cameraPresented,
                    video: route == .video,
                    onImage: { image in Task { await model.addCameraImage(image) } },
                    onVideo: { url in Task { await model.addVideo(from: url); try? FileManager.default.removeItem(at: url) } }
                )
                .ignoresSafeArea()
            }
            } // ScrollViewReader
        }
    }

    // Red-tint a required section's rows once the user tried to Post while it's
    // still incomplete (web parity: missed fields become obvious). nil = default.
    private func rowBG(_ f: PostModel.FormField) -> Color? {
        (attemptedSubmit && model.missingFields.contains(f)) ? Color.red.opacity(0.12) : nil
    }

    // Bool binding the CameraPicker uses to dismiss itself → clears the route.
    private var cameraPresented: Binding<Bool> {
        Binding(get: { cameraRoute != nil }, set: { if !$0 { cameraRoute = nil } })
    }

    // ── photos ──
    private var photosSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Menu {
                        Button { cameraRoute = .photo } label: { Label(L10n.tr("Take Photo", "Chụp ảnh"), systemImage: "camera") }
                        Button { showLibrary = true } label: { Label(L10n.tr("Photo Library", "Thư viện ảnh"), systemImage: "photo.on.rectangle") }
                        if model.videoURL == nil && !model.videoUploading {
                            Button { cameraRoute = .video } label: { Label(L10n.tr("Record Video", "Quay video"), systemImage: "video") }
                            Button { showVideoLibrary = true } label: { Label(L10n.tr("Choose Video", "Chọn video"), systemImage: "film") }
                        }
                    } label: {
                        VStack(spacing: 6) {
                            EnoIcon("camera", .md, color: EnoColor.brand)
                            Text(L10n.tr("Add", "Thêm")).font(EnoTextRole.caption.font.weight(.semibold))
                        }
                        .foregroundStyle(EnoColor.brand)
                        .frame(width: 84, height: 84)
                        .background(EnoColor.brandTint, in: RoundedRectangle(cornerRadius: EnoRadius.card))
                    }
                    .buttonStyle(.plain)
                    ForEach(model.photos) { photo in
                        photoThumb(photo)
                    }
                }
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
            Text(L10n.tr("At least 3 photos from different angles.", "Ít nhất 3 ảnh chụp các góc khác nhau."))
                .font(EnoTextRole.caption.font)
                .foregroundStyle(model.uploadedUrls.count >= 3 ? EnoColor.sub : EnoColor.brand)
            // Optional single clip status (≤60s).
            if model.videoUploading {
                HStack(spacing: 8) {
                    ProgressView().tint(EnoColor.brand)
                    Text(L10n.tr("Uploading video…", "Đang tải video…")).enoText(.caption, color: EnoColor.sub)
                }
            } else if model.videoURL != nil {
                HStack(spacing: 8) {
                    EnoIcon("success").foregroundStyle(EnoColor.success)
                    Text(L10n.tr("Video added", "Đã thêm video")).enoText(.caption, color: EnoColor.fg)
                    Spacer()
                    Button(L10n.tr("Remove", "Xóa")) { model.removeVideo() }
                        .enoText(.caption, color: EnoColor.danger, weight: .semibold)
                }
            }
            if let vErr = model.videoError {
                Text(vErr).enoText(.caption, color: EnoColor.danger)
            }
            // ✨ AI auto-fill — appears once there's a photo; reads the item and
            // prefills category/condition/title (the seller reviews + adds the rest).
            if !model.photos.isEmpty {
                Button {
                    Task { await model.autofill() }
                } label: {
                    HStack(spacing: 8) {
                        if model.autofilling { ProgressView().tint(EnoColor.brand) }
                        else { EnoIcon("ai", .sm, color: EnoColor.brand) }
                        Text(L10n.tr("Auto-fill from photo", "Điền tự động từ ảnh"))
                            .font(EnoTextRole.subheadline.font.weight(.semibold))
                    }
                    .foregroundStyle(EnoColor.brand)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(EnoColor.brandTint, in: RoundedRectangle(cornerRadius: EnoRadius.control))
                }
                .buttonStyle(.plain)
                .disabled(model.autofilling)
                if let err = model.autofillError {
                    Text(err).enoText(.caption, color: EnoColor.danger)
                }
            }
        } header: {
            Text(L10n.tr("Photos", "Hình ảnh"))
        }
        .photosPicker(isPresented: $showLibrary, selection: $picker,
                      maxSelectionCount: max(1, 6 - model.photos.count), matching: .images)
        .photosPicker(isPresented: $showVideoLibrary, selection: $videoPick, matching: .videos)
        .onChange(of: picker) {
            let items = picker
            picker = []
            Task { await model.add(items: items) }
        }
        .onChange(of: videoPick) {
            guard let item = videoPick else { return }
            videoPick = nil
            Task {
                if let movie = try? await item.loadTransferable(type: MovieFile.self) {
                    await model.addVideo(from: movie.url)
                    try? FileManager.default.removeItem(at: movie.url)
                }
            }
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
                    EnoIcon("retry")
                        .foregroundStyle(.white)
                        .frame(width: 84, height: 84)
                        .background(.black.opacity(0.45), in: RoundedRectangle(cornerRadius: Tokens.radiusCard))
                }
            }
            Button {
                model.remove(photo.id)
            } label: {
                EnoIcon("close", .xs, color: .white)
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
                    set: { slug in model.pickSubcategory(model.subs.first { $0.slug == slug }) }
                )) {
                    Text(L10n.tr("Auto", "Tự chọn")).tag("")
                    ForEach(model.subs) { sub in
                        Text(sub.displayName).tag(sub.slug)
                    }
                }
            }
            // Intent (sell/rent/wanted/…): shown only when the category offers a
            // choice — matches the web wizard's type picker + sale/rent toggle.
            if model.types.count > 1 {
                Picker(L10n.tr("Listing type", "Loại tin"), selection: Binding(
                    get: { model.listingType ?? model.types.first?.value ?? "sell" },
                    set: { model.listingType = $0 }
                )) {
                    ForEach(model.types) { t in
                        Text(t.displayName).tag(t.value)
                    }
                }
            }
            if model.brandable {
                TextField(L10n.tr("Brand (optional)", "Hãng (không bắt buộc)"), text: $model.brand)
                    .autocorrectionDisabled()
                if !model.brand.trimmingCharacters(in: .whitespaces).isEmpty {
                    TextField(L10n.tr("Model (optional)", "Dòng máy (không bắt buộc)"), text: $model.model)
                        .autocorrectionDisabled()
                }
            }
        }
    }

    // ── details ──
    private var detailsSection: some View {
        Section {
            TextField(L10n.tr("Title", "Tiêu đề"), text: $model.title)
            TextField(L10n.tr("Description", "Mô tả"), text: $model.descriptionText, axis: .vertical)
                .lineLimit(3...8)
        } header: {
            Text(L10n.tr("Details", "Chi tiết"))
        } footer: {
            // Web parity: description is required, ≥20 characters.
            let n = model.descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).count
            if n < 20 {
                Text(L10n.tr("Describe the item in at least 20 characters (\(n)/20).",
                             "Mô tả món đồ bằng ít nhất 20 ký tự (\(n)/20)."))
                    .foregroundStyle(n > 0 ? Tokens.brand : Tokens.sub)
            }
        }
    }

    // ── specifics (condition + per-category facets, mirroring the web wizard) ──
    @ViewBuilder
    private var specificsSection: some View {
        if model.conditionFacet != nil || !model.chipFacets.isEmpty || !model.rangeFacets.isEmpty {
            Section(L10n.tr("Specifics", "Thông số")) {
                if let cond = model.conditionFacet {
                    Picker(cond.displayLabel, selection: Binding(
                        get: { model.condition ?? "" },
                        set: { model.condition = $0.isEmpty ? nil : $0 }
                    )) {
                        Text(L10n.tr("Choose…", "Chọn…")).tag("")
                        ForEach(cond.options) { o in
                            Text(o.displayName).tag(o.value)
                        }
                    }
                }
                ForEach(model.chipFacets) { facet in
                    Picker(facet.displayLabel, selection: Binding(
                        get: { model.attributes[facet.key] ?? "" },
                        set: { model.attributes[facet.key] = $0 }
                    )) {
                        Text(L10n.tr("Choose…", "Chọn…")).tag("")
                        ForEach(facet.options) { o in
                            Text(o.displayName).tag(o.value)
                        }
                    }
                }
                ForEach(model.rangeFacets) { facet in
                    if let range = facet.range {
                        HStack {
                            Text(facet.displayLabel)
                            Spacer()
                            TextField(rangePlaceholder(range), text: Binding(
                                get: { model.rangeTexts[range.column] ?? "" },
                                set: { model.rangeTexts[range.column] = $0 }
                            ))
                            .keyboardType(range.column == "engineL" ? .decimalPad : .numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 120)
                            if let unit = range.unit {
                                Text(unit).foregroundStyle(Tokens.sub)
                            }
                        }
                    }
                }
            }
        }
    }

    private func rangePlaceholder(_ range: CategoriesResponse.Facet.RangeMeta) -> String {
        "\(Int(range.min))–\(Int(range.max))"
    }

    // ── price ──
    private var priceSection: some View {
        Section {
            HStack {
                TextField("0", text: $model.priceText)
                    .keyboardType(.numberPad)
                Text("đ").foregroundStyle(Tokens.sub)
            }
            EnoToggle(L10n.tr("Open to offers", "Cho phép trả giá"), isOn: Binding(
                get: { model.negotiable },
                set: { model.setNegotiable($0) }
            ))
            EnoToggle(L10n.tr("Urgent sale", "Bán gấp"), isOn: Binding(
                get: { model.urgent },
                set: { model.setUrgent($0) }
            ))
        } header: {
            Text(L10n.tr("Price", "Giá"))
        } footer: {
            if model.urgent {
                Text(L10n.tr("Urgent listings stay open to offers and get a highlighted badge for a few days.",
                             "Tin bán gấp luôn cho phép trả giá và được gắn nhãn nổi bật trong vài ngày."))
            }
        }
    }

    // ── location ──
    private var locationSection: some View {
        Section {
            // Web parity: a one-tap "Use my current location" that geolocates and
            // fills Province + Ward, above the manual pickers.
            Button {
                Task { await model.useMyLocation() }
            } label: {
                HStack(spacing: 8) {
                    if model.locating {
                        ProgressView().controlSize(.small)
                    } else {
                        EnoIcon("map-pin")
                    }
                    Text(L10n.tr("Use my current location", "Dùng vị trí hiện tại"))
                        .fontWeight(.semibold)
                    Spacer()
                }
                .foregroundStyle(Tokens.brand)
            }
            .disabled(model.locating)
            if let err = model.locationError {
                Text(err).enoText(.caption, color: EnoColor.danger)
            }
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
                    set: { code in model.pickWard(code) }
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
            TextField(L10n.tr("Name or shop name", "Tên hoặc tên cửa hàng"), text: $model.contactName)
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
    private func submitSection(_ proxy: ScrollViewProxy) -> some View {
        Section {
            Button {
                if model.canSubmit {
                    // ⛔ SIGN IN BEFORE PUBLISH — THIS IS A LEGAL GATE, NOT A CONVENIENCE.
                    // The server supports guest posting by phone (the Chợ Tốt pattern,
                    // src/app/api/listings/route.ts:259), and that path resolves a GUEST storefront
                    // with no `ownerId` and therefore no Profile. `assertIdentityVerified` opens with
                    // `if (status == null) return` (src/lib/publish-guard.ts:228) — an absent status
                    // means "this caller has no profile loaded", not "unverified" — so a guest post
                    // sails straight past the NĐ 248/2026 identity gate. The WEB closes that door by
                    // calling openSignIn() once the draft is valid (post-wizard.tsx:635-643); iOS
                    // never did, so this app was the one CLIENT that walked sellers past it.
                    // ⚠️ AND A CLIENT GATE DOES NOT CLOSE A SERVER HOLE — say so rather than implying
                    // otherwise. A direct POST, or an older build of this app, still reaches the guest
                    // path and still skips `assertIdentityVerified`. Closing that properly means
                    // rejecting profile-less publishes in `src/lib/publish-guard.ts`, which is a
                    // server change affecting both editions and is NOT in this commit.
                    // ⚠️ DRAFT-FIRST, exactly like the web: the seller fills everything in, and only
                    // the final tap asks them to sign in — nothing they typed is lost.
                    if auth.isSignedIn {
                        Task { await model.submit() }
                    } else {
                        signInSheet = true
                    }
                } else {
                    // Web scrollToMissing parity: reveal the gaps (red highlights)
                    // and jump to the first incomplete section.
                    attemptedSubmit = true
                    if let first = model.missingFields.first {
                        withAnimation { proxy.scrollTo(first, anchor: .top) }
                    }
                }
            } label: {
                Group {
                    if model.submitting {
                        ProgressView().tint(EnoColor.onBrand)
                    } else {
                        Text(L10n.tr("Post listing", "Đăng tin"))
                    }
                }
                .font(EnoTextRole.headline.font)
                .foregroundStyle(EnoColor.onBrand)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(model.canSubmit ? EnoColor.brand : EnoColor.sub, in: RoundedRectangle(cornerRadius: EnoRadius.control))
            }
            // Stays tappable when incomplete — the tap reveals what's missing and
            // scrolls to it, instead of a dead disabled button (web parity).
            .disabled(model.submitting)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            if let err = model.errorMessage {
                Text(err)
                    .enoText(.caption, color: EnoColor.danger)
            }
        }
    }

    private func successSheet(_ id: String) -> some View {
        VStack(spacing: 16) {
            EnoIcon("success", .xl, color: EnoColor.success)
            Text(L10n.tr("Your listing is live!", "Tin của bạn đã được đăng!"))
                .enoText(.title, color: EnoColor.fg)
            Text(L10n.tr("Buyers can see it right away. You'll be notified about messages and offers.",
                         "Người mua có thể xem ngay. Bạn sẽ nhận thông báo khi có tin nhắn hoặc trả giá."))
                .enoText(.callout, color: EnoColor.sub)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            EnoButton(L10n.tr("Done", "Xong"), size: .large) {
                success = nil
            }
        }
        .padding(24)
        .presentationDetents([.height(320)])
    }
}

// Tap-anywhere-to-dismiss the keyboard, working even inside Form/List (whose row
// backgrounds swallow SwiftUI's own tap gestures). A window-level tap recognizer
// observes touches via its delegate: on a touch that ISN'T a text input or the
// keyboard, it resigns first responder as a side effect and returns false, so the
// touch is never captured — Form rows, Buttons and Pickers still act, and a tap on
// a control both dismisses AND fires it. Pattern validated by Gemini 3.1 Pro +
// GPT-5.6 (both also endorse .scrollDismissesKeyboard + the keyboard Done button).
final class KeyboardDismissGesture: NSObject, UIGestureRecognizerDelegate {
    static let shared = KeyboardDismissGesture()
    private var installed = false

    static func resign() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    func installOnce() {
        guard !installed,
              let window = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap({ $0.windows })
                .first(where: { $0.isKeyWindow })
        else { return }
        let tap = UITapGestureRecognizer(target: nil, action: nil)
        tap.delegate = self
        tap.cancelsTouchesInView = false
        window.addGestureRecognizer(tap)
        installed = true
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        // Skip text inputs so focusing / switching fields isn't broken — walk UP
        // from the hit view, which can be a subview of the field.
        var v = touch.view
        while let cur = v {
            if cur is UITextField || cur is UITextView { return false }
            v = cur.superview
        }
        // Skip the keyboard's own window.
        if let w = touch.window, NSStringFromClass(type(of: w)).contains("UIRemoteKeyboardWindow") { return false }
        KeyboardDismissGesture.resign()
        return false // never capture the touch — controls still act
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith o: UIGestureRecognizer) -> Bool { true }
}

extension View {
    /// Install the window-level tap-to-dismiss once, when this view appears.
    func hideKeyboardOnTapAnywhere() -> some View {
        onAppear { KeyboardDismissGesture.shared.installOnce() }
    }
}
