import re

with open('src/app/pages/AccountantPortal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

divs = len(re.findall(r'<\s*div[^>]*>', content))
end_divs = len(re.findall(r'</\s*div\s*>', content))
print(f"Global: <div> tags = {divs}, </div> tags = {end_divs}")

forms = len(re.findall(r'<\s*form[^>]*>', content))
end_forms = len(re.findall(r'</\s*form\s*>', content))
print(f"Global: <form> tags = {forms}, </form> tags = {end_forms}")

