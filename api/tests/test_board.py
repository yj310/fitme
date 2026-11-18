"""피드백 게시판: users see only their own posts; only the admin manages status and replies."""

from tests.conftest import USER_A, USER_B


def post(h, body="사진 올리기 버튼이 안 눌려요", **kw):
    r = h.client.post("/api/v1/board/posts", json={"kind": "bug", "body": body, "page": "옷장", **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_write_and_see_own_posts(h):
    h.as_user(USER_A)
    up = h.client.post("/api/v1/board/upload-url", json={"content_type": "image/webp"}).json()
    assert up["path"].startswith(USER_A + "/")
    p = post(h, "운동화가 샌들로 태그돼요\n두 번째 줄", image_paths=[up["path"]], device="iPhone · Safari")
    assert p["status"] == "new" and p["title"] == "운동화가 샌들로 태그돼요" and not p["unread"]
    assert p["images"][0]["url"].startswith("https://storage.test/sign/board/")
    mine = h.client.get("/api/v1/board/mine").json()
    assert [x["id"] for x in mine["posts"]] == [p["id"]] and mine["unread"] == 0


def test_cannot_attach_someone_elses_photo(h):
    h.as_user(USER_A)
    r = h.client.post("/api/v1/board/posts", json={"kind": "bug", "body": "x", "image_paths": [f"{USER_B}/a.webp"]})
    assert r.status_code == 403
    r = h.client.post("/api/v1/board/posts", json={"kind": "bug", "body": "x",
                                                   "image_paths": [f"{USER_A}/{i}.webp" for i in range(6)]})
    assert r.status_code == 422
    assert h.client.post("/api/v1/board/posts", json={"kind": "bug", "body": "   "}).status_code == 422


def test_only_admin_manages(h):
    h.as_user(USER_A)
    p = post(h)
    # A is not an admin
    assert h.client.get("/api/v1/admin/board").status_code == 403
    assert h.client.patch(f"/api/v1/admin/board/{p['id']}", json={"status": "done"}).status_code == 403
    assert h.client.get("/api/v1/me").json()["is_admin"] is False

    h.as_user(USER_B)  # admin
    assert h.client.get("/api/v1/me").json()["is_admin"] is True
    assert h.client.get("/api/v1/board/mine").json()["posts"] == []  # B's own posts: none
    lst = h.client.get("/api/v1/admin/board").json()
    assert lst["counts"]["new"] == 1 and lst["posts"][0]["author"] == "테스터"
    one = h.client.patch(f"/api/v1/admin/board/{p['id']}", json={"status": "doing"}).json()
    assert one["status"] == "doing" and one["comments"][-1]["kind"] == "status"
    one = h.client.post(f"/api/v1/admin/board/{p['id']}/comments", json={"body": "고치는 중이에요"}).json()
    assert one["comments"][-1]["is_admin"] and one["comments"][-1]["body"] == "고치는 중이에요"
    assert h.client.patch(f"/api/v1/admin/board/{p['id']}", json={"status": "closed"}).status_code == 422

    h.as_user(USER_A)  # the author sees the update as unread until they open 내 피드백
    mine = h.client.get("/api/v1/board/mine").json()
    assert mine["unread"] == 1 and mine["posts"][0]["status"] == "doing"
    assert [c["body"] for c in mine["posts"][0]["comments"] if c["kind"] == "comment"] == ["고치는 중이에요"]
    assert h.client.post("/api/v1/board/mine/seen").status_code == 204
    assert h.client.get("/api/v1/board/mine").json()["unread"] == 0


def test_comments_only_on_own_posts(h):
    h.as_user(USER_A)
    p = post(h)
    assert h.client.post(f"/api/v1/board/posts/{p['id']}/comments", json={"body": "다시 해 보니 또 그래요"}).status_code == 200
    assert h.client.post(f"/api/v1/board/posts/{p['id']}/comments", json={"body": ""}).status_code == 400
    h.as_user(USER_B)
    # B can't comment on A's post as a user (only through the admin endpoint)
    assert h.client.post(f"/api/v1/board/posts/{p['id']}/comments", json={"body": "끼어들기"}).status_code == 404


def test_account_deletion_removes_board_photos(h):
    h.as_user(USER_A)
    run_seed = h.client.post("/api/v1/board/upload-url", json={"content_type": "image/webp"}).json()
    post(h, image_paths=[run_seed["path"]])
    assert h.client.delete("/api/v1/me").status_code == 204
    assert h.storages[USER_A].buckets["board"].removed == [run_seed["path"]]
