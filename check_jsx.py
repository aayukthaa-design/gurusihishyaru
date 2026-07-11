import re

with open('src/app/pages/AccountantPortal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# find the showAddInvModal block
start_str = '{showAddInvModal && ('
start_idx = content.find(start_str)

if start_idx != -1:
    # simple balancer
    idx = start_idx + len(start_str)
    open_parens = 1
    end_idx = -1
    for i in range(idx, len(content)):
        if content[i] == '(':
            open_parens += 1
        elif content[i] == ')':
            open_parens -= 1
            if open_parens == 0:
                end_idx = i
                break
    
    if end_idx != -1:
        block = content[start_idx:end_idx+1]
        divs = len(re.findall(r'<\s*div[^>]*>', block))
        end_divs = len(re.findall(r'</\s*div\s*>', block))
        print(f"showAddInvModal block: <div> tags = {divs}, </div> tags = {end_divs}")
        
        forms = len(re.findall(r'<\s*form[^>]*>', block))
        end_forms = len(re.findall(r'</\s*form\s*>', block))
        print(f"showAddInvModal block: <form> tags = {forms}, </form> tags = {end_forms}")
