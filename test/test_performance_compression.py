from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient


def test_gzip_compresses_lists_but_preserves_event_streams():
    app = FastAPI()
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=1)

    @app.get('/list')
    def accounts():
        return {'items': [{'email': 'test@example.test'}] * 1000}

    @app.get('/stream')
    def stream():
        return StreamingResponse(iter(['data: ' + 'x' * 2048 + '\n\n']),
                                 media_type='text/event-stream')

    client = TestClient(app)
    response = client.get('/list', headers={'Accept-Encoding': 'gzip'})
    assert response.headers['content-encoding'] == 'gzip'
    assert len(response.json()['items']) == 1000
    response = client.get('/stream', headers={'Accept-Encoding': 'gzip'})
    assert 'content-encoding' not in response.headers
    assert response.text.startswith('data: ')
