from playwright.sync_api import sync_playwright
import json, sys

URL = 'http://127.0.0.1:5173/'
VIEWPORTS = [
    {'name': 'phone-390', 'width': 390, 'height': 844},
    {'name': 'phone-320', 'width': 320, 'height': 568},
]

console_logs = []
page_errors = []

def log_console(msg):
    console_logs.append({'type': msg.type, 'text': msg.text, 'location': str(msg.location)})

def log_error(err):
    page_errors.append({'message': err.message, 'stack': err.stack})

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for vp in VIEWPORTS:
            context = browser.new_context(viewport={'width': vp['width'], 'height': vp['height']})
            page = context.new_page()
            page.on('console', log_console)
            page.on('pageerror', log_error)
            page.goto(URL)
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(1000)
            page.screenshot(path=f'output/ui-audit-home-{vp["name"]}.png', full_page=True)
            with open(f'output/ui-audit-home-{vp["name"]}.html', 'w', encoding='utf-8') as f:
                f.write(page.content())
            print(f'screenshot {vp["name"]} done')
            context.close()
        browser.close()

    with open('output/ui-audit-console.json', 'w', encoding='utf-8') as f:
        json.dump({'console': console_logs, 'pageErrors': page_errors}, f, ensure_ascii=False, indent=2)
    print('audit recon done')

if __name__ == '__main__':
    main()
